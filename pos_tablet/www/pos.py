import frappe


def get_context(context):
	# exige sessão iniciada
	if frappe.session.user == "Guest":
		frappe.local.flags.redirect_location = "/login?redirect-to=/pos"
		raise frappe.Redirect

	context.no_cache = 1
	try:
		context.csrf_token = frappe.sessions.get_csrf_token()
	except Exception:
		context.csrf_token = frappe.local.session.data.get("csrf_token", "")
	return context
