// pos_tablet — melhorias do POS do ERPNext para tablets.  (v3)
//
//   1) Teclado: inputmode="none" nos campos → o teclado nativo do tablet não abre.
//   2) Quantidades rápidas: botões – / + em cada linha do carrinho (gated por site).
//   3) Impressora Bluetooth: botão "Send to printer" no resumo do checkout, imprime
//      o recibo simplificado numa Tronic 5890 / "Mini Pocket Printer" via Web Bluetooth.
//
// Web Bluetooth: só Android/Windows/macOS + Chrome/Edge (iOS/Safari não suporta).
// O botão da impressora só aparece se navigator.bluetooth existir.

(function () {
	"use strict";
	try { window.__pos_tablet = "v3-printer"; console.log("[pos_tablet] carregado v3-printer"); } catch (e) {}

	// ---- config ---------------------------------------------------------------
	const POS_ROUTE = "point-of-sale";
	const POS_SELECTOR = ".point-of-sale-app";
	const SEARCH_KEYBOARD = false;                 // true → deixa teclado na pesquisa
	const QTY_SITES = ["erp-test.gdpiao.pt"];      // onde os botões –/+ estão ligados
	// -----------------------------------------------------------------------------

	const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
	function currentSite() {
		try { return (frappe.boot && frappe.boot.sitename) || location.hostname; } catch (e) { return location.hostname; }
	}
	function qtyEnabled() { return QTY_SITES.indexOf(currentSite()) !== -1; }
	function flt(v) { return (window.flt ? window.flt(v) : parseFloat(v)) || 0; }
	function onPos() {
		try { if (window.frappe && frappe.get_route && frappe.get_route()[0] === POS_ROUTE) return true; } catch (e) {}
		return !!document.querySelector(POS_SELECTOR);
	}

	// ============================================================================
	// 1) suprimir teclado virtual
	// ============================================================================
	function suppressKeyboard() {
		const root = document.querySelector(POS_SELECTOR) || document;
		root.querySelectorAll("input, textarea").forEach(function (el) {
			const type = (el.getAttribute("type") || "").toLowerCase();
			if (type === "checkbox" || type === "radio") return;
			const isSearch = el.classList.contains("search-field") || (el.closest && el.closest(".search-field"));
			if (SEARCH_KEYBOARD && isSearch) return;
			if (el.dataset.ptKb) return;
			el.dataset.ptKb = "1";
			el.setAttribute("inputmode", "none");
			el.setAttribute("autocomplete", "off");
			if (document.activeElement === el) el.blur();
		});
	}

	// ============================================================================
	// 2) steppers de quantidade no carrinho
	// ============================================================================
	function getRow(name) {
		try { return cur_pos.frm.doc.items.find(function (i) { return i.name === name; }); } catch (e) { return null; }
	}
	async function inc(name) {
		try { await cur_pos.on_cart_update({ field: "qty", value: "+1", item: { name: name } }); }
		catch (e) { console.log("[pos_tablet] inc", e); }
	}
	async function dec(name) {
		try {
			const row = getRow(name); if (!row) return;
			const q = flt(row.qty);
			if (q > 1) { await frappe.model.set_value(row.doctype, row.name, "qty", q - 1); cur_pos.update_cart_html(row); }
			else { cur_pos.item_details.toggle_item_details_section(row); await cur_pos.remove_item_from_cart(); }
		} catch (e) { console.log("[pos_tablet] dec", e); }
	}
	function addSteppers() {
		if (!qtyEnabled() || !window.cur_pos || !cur_pos.frm) return;
		document.querySelectorAll(POS_SELECTOR + " .cart-item-wrapper[data-row-name]").forEach(function (w) {
			if (w.querySelector(".pt-qty")) return;
			const name = w.getAttribute("data-row-name"); if (!name) return;
			const bar = document.createElement("div"); bar.className = "pt-qty";
			const minus = document.createElement("button"); minus.type = "button"; minus.className = "pt-qty-btn pt-minus"; minus.textContent = "−";
			const plus = document.createElement("button"); plus.type = "button"; plus.className = "pt-qty-btn pt-plus"; plus.textContent = "+";
			function stop(e) { e.preventDefault(); e.stopPropagation(); }
			minus.addEventListener("click", function (e) { stop(e); dec(name); });
			plus.addEventListener("click", function (e) { stop(e); inc(name); });
			[minus, plus].forEach(function (b) { b.addEventListener("mousedown", stop); b.addEventListener("touchstart", function (e) { e.stopPropagation(); }, { passive: true }); });
			bar.appendChild(minus); bar.appendChild(plus); w.appendChild(bar);
		});
	}

	// ============================================================================
	// 3) impressora Bluetooth (Tronic 5890 / Mini Pocket Printer, BLE)
	// ============================================================================
	const P = { SERVICE: 0xff00, CHAR_WRITE: 0xff02, CHAR_NOTIFY: 0xff01, WIDTH: 384, BPR: 48,
		device: null, server: null, writeChar: null, done: false };

	async function connectPrinter() {
		if (P.server && P.device && P.device.gatt.connected && P.writeChar) return;
		P.device = await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: "Mini Pocket" }], optionalServices: [P.SERVICE] });
		P.device.addEventListener("gattserverdisconnected", function () { P.server = null; P.writeChar = null; });
		P.server = await P.device.gatt.connect();
		const svc = await P.server.getPrimaryService(P.SERVICE);
		P.writeChar = await svc.getCharacteristic(P.CHAR_WRITE);
		P.notifyChar = await svc.getCharacteristic(P.CHAR_NOTIFY);
		await P.notifyChar.startNotifications();
		P.notifyChar.addEventListener("characteristicvaluechanged", function (e) {
			const v = new Uint8Array(e.target.value.buffer);
			if (v.length >= 3 && v[0] === 0xAA && v[1] === 0x0D && v[2] === 0x0A) P.done = true;
		});
	}

	async function writeChunks(data) {
		for (let i = 0; i < data.length; i += 180) {
			await P.writeChar.writeValueWithoutResponse(data.slice(i, i + 180));
			await sleep(25);
		}
	}

	function packJob(bits, h) {
		const BPR = P.BPR, W = P.WIDTH;
		const data = new Uint8Array(BPR * h);
		for (let y = 0; y < h; y++) for (let x = 0; x < W; x++) if (bits[y * W + x]) data[y * BPR + (x >> 3)] |= 0x80 >> (x & 7);
		const head = [0x1D, 0x76, 0x30, 0x00, BPR, 0x00, h & 0xFF, h >> 8];
		const job = new Uint8Array(16 + 8 + data.length + 7);
		job.set([0x10, 0xFF, 0xF1, 0x03], 0);                 // ativar (+12 nulos já a zero)
		job.set(head, 16);
		job.set(data, 24);
		job.set([0x1B, 0x4A, 0x50], 24 + data.length);        // feed
		job.set([0x10, 0xFF, 0xF1, 0x45], 27 + data.length);  // fim
		return job;
	}

	function money(n) { return (Number(n) || 0).toFixed(2).replace(".", ",") + " €"; }

	function renderReceipt(doc) {
		const W = P.WIDTH, MAXH = 4000, PAD = 8;
		const c = document.createElement("canvas"); c.width = W; c.height = MAXH;
		const ctx = c.getContext("2d");
		ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, MAXH);
		ctx.fillStyle = "#000"; ctx.textBaseline = "top";
		let y = PAD;
		function center(t, s, b) { ctx.font = (b ? "bold " : "") + s + "px monospace"; ctx.textAlign = "center"; ctx.fillText(t || "", W / 2, y); y += s + 5; }
		function left(t, s, b) { ctx.font = (b ? "bold " : "") + s + "px monospace"; ctx.textAlign = "left"; ctx.fillText(t || "", 6, y); y += s + 5; }
		function lr(l, r, s, b) { ctx.font = (b ? "bold " : "") + s + "px monospace"; ctx.textAlign = "left"; ctx.fillText(l || "", 6, y); ctx.textAlign = "right"; ctx.fillText(r || "", W - 6, y); y += s + 5; }
		function hr() { y += 3; ctx.fillRect(6, y, W - 12, 2); y += 9; }

		center(doc.company, 26, true);
		center("Recibo Simplificado", 18, false);
		hr();
		left(doc.name, 16, false);
		var when = (doc.posting_date || "") + " " + (doc.posting_time ? String(doc.posting_time).split(".")[0] : "");
		if (when.trim()) left(when.trim(), 16, false);
		hr();
		(doc.items || []).forEach(function (it) {
			const qty = Number(it.qty) || 0;
			const name = (it.item_name || it.item_code || "").substring(0, 20);
			const amt = money(it.amount != null ? it.amount : qty * (it.rate || 0));
			lr(qty + "x " + name, amt, 20, false);
		});
		hr();
		lr("TOTAL", money(doc.grand_total), 28, true);
		if (doc.paid_amount != null) lr("Pago", money(doc.paid_amount), 18, false);
		if (doc.change_amount) lr("Troco", money(doc.change_amount), 18, false);
		hr();
		center("Obrigado!", 20, true);
		y += PAD;

		const h = Math.min(Math.ceil(y), MAXH);
		const img = ctx.getImageData(0, 0, W, h).data;
		const bits = new Uint8Array(W * h);
		for (let i = 0; i < W * h; i++) {
			const lum = img[i * 4] * 0.299 + img[i * 4 + 1] * 0.587 + img[i * 4 + 2] * 0.114;
			bits[i] = lum < 128 ? 1 : 0;
		}
		return { bits: bits, h: h };
	}

	function setBtn(btn, text, busy) {
		btn.textContent = text;
		if (busy) btn.setAttribute("data-busy", "1"); else btn.removeAttribute("data-busy");
	}
	function resetBtn(btn) { setBtn(btn, "Send to printer", false); }

	async function doPrint(btn) {
		if (btn.getAttribute("data-busy")) return;
		try {
			if (!navigator.bluetooth) throw new Error("Sem Bluetooth");
			const doc = (window.cur_pos && cur_pos.order_summary && cur_pos.order_summary.doc) || null;
			if (!doc) throw new Error("Sem recibo");
			setBtn(btn, "A ligar…", true);
			await connectPrinter();
			setBtn(btn, "A imprimir…", true);
			const r = renderReceipt(doc);
			P.done = false;
			await writeChunks(packJob(r.bits, r.h));
			// esperar confirmação AA 0D 0A (até 20s)
			let waited = 0;
			while (!P.done && waited < 20000) { await sleep(250); waited += 250; }
			setBtn(btn, P.done ? "Impresso ✓" : "Enviado", false);
			setTimeout(function () { resetBtn(btn); }, 3000);
		} catch (e) {
			console.log("[pos_tablet] print", e);
			setBtn(btn, "Erro: " + ((e && e.message) || e), false);
			setTimeout(function () { resetBtn(btn); }, 4000);
		}
	}

	function addPrinterButton() {
		if (!navigator.bluetooth) return;  // só onde há Web Bluetooth
		document.querySelectorAll(POS_SELECTOR + " .summary-btns").forEach(function (bar) {
			if (bar.querySelector(".pt-print-btn")) return;
			const btn = document.createElement("div");
			btn.className = "summary-btn btn btn-default pt-print-btn";
			btn.textContent = "Send to printer";
			btn.addEventListener("click", function () { doPrint(btn); });
			const email = bar.querySelector(".email-btn");
			const print = bar.querySelector(".print-btn");
			if (email) email.insertAdjacentElement("afterend", btn);
			else if (print) print.insertAdjacentElement("afterend", btn);
			else bar.appendChild(btn);
		});
	}

	// ---- estilos ---------------------------------------------------------------
	function injectStyleOnce() {
		if (document.getElementById("pt-style")) return;
		const css = document.createElement("style");
		css.id = "pt-style";
		css.textContent = [
			".point-of-sale-app .cart-item-wrapper{position:relative;}",
			".point-of-sale-app .pt-qty{display:flex;gap:8px;justify-content:flex-end;margin-top:6px;}",
			".point-of-sale-app .pt-qty-btn{min-width:48px;min-height:48px;font-size:24px;line-height:1;font-weight:700;",
			"border-radius:10px;border:1px solid var(--gray-300,#c9ccd1);background:var(--fg-color,#fff);",
			"color:var(--text-color,#1f272e);display:flex;align-items:center;justify-content:center;",
			"user-select:none;-webkit-user-select:none;touch-action:manipulation;cursor:pointer;}",
			".point-of-sale-app .pt-qty-btn:active{transform:scale(.94);}",
			".point-of-sale-app .pt-plus{background:var(--primary,#2490ef);color:#fff;border-color:transparent;}",
			".point-of-sale-app .pt-minus{background:var(--red-100,#fff2f0);color:var(--red-600,#c0392b);border-color:var(--red-300,#f5b1a6);}",
			".point-of-sale-app .pt-print-btn[data-busy]{opacity:.7;pointer-events:none;}"
		].join("");
		document.head.appendChild(css);
	}

	// ---- loop -------------------------------------------------------------------
	let observer = null, scheduled = false;
	function enhance() {
		scheduled = false;
		if (!onPos()) return;
		suppressKeyboard();
		try { addSteppers(); } catch (e) { console.log("[pos_tablet] addSteppers", e); }
		try { addPrinterButton(); } catch (e) { console.log("[pos_tablet] addPrinterButton", e); }
	}
	function schedule() { if (scheduled) return; scheduled = true; setTimeout(enhance, 120); }
	function start() {
		if (!onPos()) return;
		injectStyleOnce(); enhance();
		if (observer) return;
		observer = new MutationObserver(schedule);
		observer.observe(document.body, { childList: true, subtree: true });
	}
	function stop() { if (observer) { observer.disconnect(); observer = null; } }

	function boot() {
		if (window.frappe && frappe.router && frappe.router.on) {
			frappe.router.on("change", function () { if (onPos()) setTimeout(start, 300); else stop(); });
		}
		setTimeout(function () { if (onPos()) start(); }, 800);
	}
	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
	else boot();
})();
