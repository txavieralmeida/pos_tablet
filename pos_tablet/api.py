import base64
import json
import mimetypes

import frappe

PRICE_LIST = "Venda Padrão"


def _image_data_uri(image):
	"""Lê o ficheiro (público ou privado) do lado do servidor e devolve-o como
	data URI base64 — assim o browser não precisa de aceder a /private/files."""
	if not image:
		return None
	try:
		rows = frappe.get_all("File", filters={"file_url": image}, fields=["name"], limit=1)
		if not rows:
			return image
		content = frappe.get_doc("File", rows[0].name).get_content()
		if isinstance(content, str):
			content = content.encode()
		mime = mimetypes.guess_type(image)[0] or "image/png"
		return "data:%s;base64,%s" % (mime, base64.b64encode(content).decode())
	except Exception:
		frappe.clear_last_message()
		return image


NO_PROFILE_MSG = (
	"Não existe nenhum perfil de POS default. "
	"Cria um perfil (POS Profile) e marca o teu utilizador como default."
)


def _get_pos_profile(required=True):
	"""Perfil de POS default do utilizador atual (como o ERPNext resolve):
	1) perfil onde o utilizador está marcado como default;
	2) qualquer perfil onde o utilizador está listado;
	3) primeiro perfil ativo.
	Se não houver nenhum: lança erro (required=True) ou devolve None (required=False)."""
	user = frappe.session.user
	name = frappe.db.get_value("POS Profile User", {"user": user, "default": 1}, "parent")
	if not name:
		name = frappe.db.get_value("POS Profile User", {"user": user}, "parent")
	if not name:
		rows = frappe.get_all("POS Profile", filters={"disabled": 0}, limit=1)
		name = rows[0].name if rows else None
	if not name:
		if required:
			frappe.throw(NO_PROFILE_MSG)
		return None
	return frappe.get_doc("POS Profile", name)


def _groups_with_descendants(groups):
	"""Expande cada grupo de itens para incluir os seus subgrupos (nested set),
	tal como o POS do ERPNext faz."""
	out = set()
	for g in groups:
		out.add(g)
		node = frappe.db.get_value("Item Group", g, ["lft", "rgt"], as_dict=True)
		if node:
			for d in frappe.get_all(
				"Item Group",
				filters={"lft": [">=", node.lft], "rgt": ["<=", node.rgt]},
				pluck="name",
			):
				out.add(d)
	return list(out)


@frappe.whitelist()
def get_pos_items():
	"""Artigos vendáveis do perfil de POS default (filtrados pelos grupos do perfil,
	ou todos se o perfil não restringir), com preço da lista do perfil e imagem.
	Devolve {error, message} quando não há perfil default ou não há artigos."""
	profile = _get_pos_profile(required=False)
	if not profile:
		return {"error": "no_pos_profile", "message": NO_PROFILE_MSG}

	price_list = profile.selling_price_list or PRICE_LIST
	filters = {"disabled": 0, "is_sales_item": 1}
	groups = [g.item_group for g in (profile.item_groups or [])]
	if groups:
		filters["item_group"] = ["in", _groups_with_descendants(groups)]

	items = frappe.get_all(
		"Item", filters=filters, fields=["item_code", "item_name", "image"], order_by="item_name"
	)
	codes = [i.item_code for i in items]
	prices = {}
	if codes:
		for p in frappe.get_all(
			"Item Price",
			filters={"price_list": price_list, "item_code": ["in", codes]},
			fields=["item_code", "price_list_rate"],
		):
			prices[p.item_code] = p.price_list_rate
	for i in items:
		i["rate"] = prices.get(i.item_code, 0) or 0
		i["image"] = _image_data_uri(i.get("image"))

	if not items:
		return {
			"error": "no_items",
			"profile": profile.name,
			"items": [],
			"message": (
				"O perfil de POS '%s' não tem artigos disponíveis. "
				"Configura os grupos de itens do perfil ou adiciona artigos vendáveis." % profile.name
			),
		}
	return {"profile": profile.name, "currency": profile.currency, "items": items}


@frappe.whitelist()
def create_sale(cart, mode_of_payment=None):
	"""Cria e submete uma venda POS a partir do carrinho, usando o perfil default."""
	cart = json.loads(cart) if isinstance(cart, str) else cart
	if not cart:
		frappe.throw("Carrinho vazio")

	profile = _get_pos_profile()

	si = frappe.new_doc("Sales Invoice")
	si.company = profile.company
	si.is_pos = 1
	si.pos_profile = profile.name
	si.customer = profile.customer
	si.selling_price_list = profile.selling_price_list or PRICE_LIST
	si.update_stock = 0
	if profile.cost_center:
		si.cost_center = profile.cost_center

	for line in cart:
		row = {"item_code": line["item_code"], "qty": line.get("qty") or 1}
		if profile.cost_center:
			row["cost_center"] = profile.cost_center
		if line.get("rate") is not None:
			row["rate"] = line["rate"]
		si.append("items", row)

	si.set_missing_values()
	si.calculate_taxes_and_totals()

	mop = mode_of_payment or (profile.payments[0].mode_of_payment if profile.payments else "Numerário")
	si.append("payments", {"mode_of_payment": mop, "amount": si.grand_total})

	si.insert(ignore_permissions=True)
	si.submit()
	frappe.db.commit()

	return {
		"name": si.name,
		"company": profile.company,
		"grand_total": si.grand_total,
		"paid_amount": si.paid_amount,
		"posting_date": str(si.posting_date),
		"posting_time": str(si.posting_time).split(".")[0],
		"items": [
			{"item_name": r.item_name, "qty": r.qty, "rate": r.rate, "amount": r.amount}
			for r in si.items
		],
	}
