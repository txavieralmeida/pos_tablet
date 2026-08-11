// pos_print.js — render + impressão do recibo (partilhado entre /pos e /pos_print).
// Impressora Tronic 5890 / "Mini Pocket Printer" (BLE, raster). Web Bluetooth.
window.POSPrint = (function () {
	"use strict";
	const SERVICE = 0xff00, CHAR_WRITE = 0xff02, CHAR_NOTIFY = 0xff01, WIDTH = 384, BPR = 48;
	const CFG_KEY = "pt_print_cfg";
	const DEFAULT_CFG = { header: "", footer: "Obrigado!", showDate: true, showInvoice: true, density: 1, scale: 1 };
	let device = null, server = null, writeChar = null, done = false, _logo = null;
	const sleep = ms => new Promise(r => setTimeout(r, ms));
	const money = n => (Number(n) || 0).toFixed(2).replace(".", ",") + " €";

	function loadCfg() {
		try { return Object.assign({}, DEFAULT_CFG, JSON.parse(localStorage.getItem(CFG_KEY) || "{}")); }
		catch (e) { return Object.assign({}, DEFAULT_CFG); }
	}
	function saveCfg(c) { localStorage.setItem(CFG_KEY, JSON.stringify(c)); }

	// carrega o logo (data URI) para uma Image; resolve quando pronto (ou sem logo)
	function setLogo(dataUri) {
		return new Promise(res => {
			if (!dataUri) { _logo = null; return res(); }
			const im = new Image();
			im.onload = () => { _logo = im; res(); };
			im.onerror = () => { _logo = null; res(); };
			im.src = dataUri;
		});
	}

	// quebra texto para caber em maxW (com fallback char-a-char para palavras enormes)
	function wrap(ctx, text, maxW) {
		const out = [];
		let cur = "";
		String(text).split(/\s+/).filter(Boolean).forEach(word => {
			let w = word;
			while (ctx.measureText(w).width > maxW && w.length > 1) {
				let i = 1;
				while (i < w.length && ctx.measureText(w.slice(0, i + 1)).width <= maxW) i++;
				if (cur) { out.push(cur); cur = ""; }
				out.push(w.slice(0, i));
				w = w.slice(i);
			}
			const t = cur ? cur + " " + w : w;
			if (ctx.measureText(t).width <= maxW || !cur) cur = t;
			else { out.push(cur); cur = w; }
		});
		if (cur) out.push(cur);
		return out.length ? out : [""];
	}

	// render do recibo → devolve {canvas, bits, h}
	function renderReceipt(doc, cfg) {
		cfg = cfg || loadCfg();
		const s = Math.max(0.7, Math.min(1.6, Number(cfg.scale) || 1));
		const MAXH = 8000, PAD = 8, M = 6;
		const c = document.createElement("canvas"); c.width = WIDTH; c.height = MAXH;
		const ctx = c.getContext("2d");
		ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, WIDTH, MAXH);
		ctx.fillStyle = "#000"; ctx.textBaseline = "top";
		let y = PAD;
		const setFont = (sz, b) => { ctx.font = (b ? "bold " : "") + Math.round(sz * s) + "px monospace"; };
		const lh = sz => Math.round(sz * s) + 5;
		const center = (text, sz, b) => { setFont(sz, b); ctx.textAlign = "center"; wrap(ctx, text, WIDTH - 2 * M).forEach(l => { ctx.fillText(l, WIDTH / 2, y); y += lh(sz); }); };
		const left = (text, sz, b) => { setFont(sz, b); ctx.textAlign = "left"; wrap(ctx, text, WIDTH - 2 * M).forEach(l => { ctx.fillText(l, M, y); y += lh(sz); }); };
		const hr = () => { y += 3; ctx.fillRect(M, y, WIDTH - 2 * M, 2); y += 9; };

		// logo (letter head) — desenhado no topo, centrado
		if (_logo && (_logo.naturalWidth || _logo.width)) {
			const iw = _logo.naturalWidth || _logo.width, ih = _logo.naturalHeight || _logo.height;
			let w = Math.min(WIDTH - 40, iw), h = Math.round(w * ih / iw);
			const capH = 170; if (h > capH) { h = capH; w = Math.round(h * iw / ih); }
			ctx.drawImage(_logo, Math.round((WIDTH - w) / 2), y, w, h);
			y += h + 8;
		}

		center(doc.company, 26, true);                                   // título (com wrap)
		if (cfg.header) String(cfg.header).split("\n").forEach(l => center(l, 15, false));
		center("Recibo Simplificado", 18, false);
		hr();
		let meta = false;
		if (cfg.showInvoice && doc.name) { left(doc.name, 16, false); meta = true; }
		if (cfg.showDate) { const w = ((doc.posting_date || "") + " " + (doc.posting_time || "")).trim(); if (w) { left(w, 16, false); meta = true; } }
		if (meta) hr();

		// itens — nome com wrap, preço alinhado na 1ª linha
		(doc.items || []).forEach(it => {
			setFont(20, false);
			const price = money(it.amount != null ? it.amount : (it.qty * it.rate));
			const priceW = ctx.measureText(price).width;
			const label = (it.qty || 0) + "x " + String(it.item_name || "");
			const lines = wrap(ctx, label, WIDTH - 2 * M - priceW - 10);
			lines.forEach((ln, idx) => {
				ctx.textAlign = "left"; ctx.fillText(ln, M, y);
				if (idx === 0) { ctx.textAlign = "right"; ctx.fillText(price, WIDTH - M, y); }
				y += lh(20);
			});
		});
		hr();

		setFont(28, true); ctx.textAlign = "left"; ctx.fillText("TOTAL", M, y);
		ctx.textAlign = "right"; ctx.fillText(money(doc.grand_total), WIDTH - M, y); y += lh(28);
		if (doc.paid_amount != null) { setFont(18, false); ctx.textAlign = "left"; ctx.fillText("Pago", M, y); ctx.textAlign = "right"; ctx.fillText(money(doc.paid_amount), WIDTH - M, y); y += lh(18); }
		if (cfg.footer) { hr(); String(cfg.footer).split("\n").forEach(l => center(l, 20, true)); }
		y += PAD;

		const h = Math.min(Math.ceil(y), MAXH);
		const out = document.createElement("canvas"); out.width = WIDTH; out.height = h;
		out.getContext("2d").drawImage(c, 0, 0);
		const img = ctx.getImageData(0, 0, WIDTH, h).data;
		const bits = new Uint8Array(WIDTH * h);
		for (let i = 0; i < WIDTH * h; i++) {
			const lum = img[i * 4] * 0.299 + img[i * 4 + 1] * 0.587 + img[i * 4 + 2] * 0.114;
			bits[i] = lum < 128 ? 1 : 0;
		}
		return { canvas: out, bits: bits, h: h };
	}

	function packJob(bits, h) {
		const data = new Uint8Array(BPR * h);
		for (let yy = 0; yy < h; yy++) for (let x = 0; x < WIDTH; x++) if (bits[yy * WIDTH + x]) data[yy * BPR + (x >> 3)] |= 0x80 >> (x & 7);
		const head = [0x1D, 0x76, 0x30, 0x00, BPR, 0x00, h & 0xFF, h >> 8];
		const job = new Uint8Array(16 + 8 + data.length + 7);
		job.set([0x10, 0xFF, 0xF1, 0x03], 0);
		job.set(head, 16); job.set(data, 24);
		job.set([0x1B, 0x4A, 0x50], 24 + data.length);
		job.set([0x10, 0xFF, 0xF1, 0x45], 27 + data.length);
		return job;
	}

	async function connect() {
		if (server && device && device.gatt.connected && writeChar) return;
		device = await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: "Mini Pocket" }], optionalServices: [SERVICE] });
		device.addEventListener("gattserverdisconnected", () => { server = null; writeChar = null; });
		server = await device.gatt.connect();
		const svc = await server.getPrimaryService(SERVICE);
		writeChar = await svc.getCharacteristic(CHAR_WRITE);
		const nt = await svc.getCharacteristic(CHAR_NOTIFY);
		await nt.startNotifications();
		nt.addEventListener("characteristicvaluechanged", e => { const v = new Uint8Array(e.target.value.buffer); if (v.length >= 3 && v[0] === 0xAA && v[1] === 0x0D && v[2] === 0x0A) done = true; });
	}
	async function writeChunks(d) { for (let i = 0; i < d.length; i += 180) { await writeChar.writeValueWithoutResponse(d.slice(i, i + 180)); await sleep(25); } }

	async function printReceipt(doc, cfg, onStatus) {
		cfg = cfg || loadCfg();
		const st = onStatus || function () {};
		if (!navigator.bluetooth) throw new Error("Sem Web Bluetooth");
		st("A ligar…"); await connect();
		st("A imprimir…");
		const dens = Math.max(0, Math.min(2, Number(cfg.density)));
		await writeChunks(new Uint8Array([0x10, 0xFF, 0x10, 0x00, dens]));
		const r = renderReceipt(doc, cfg);
		done = false;
		await writeChunks(packJob(r.bits, r.h));
		let w = 0; while (!done && w < 20000) { await sleep(250); w += 250; }
		st(done ? "Impresso ✓" : "Enviado");
		return done;
	}

	function sampleDoc(company, items) {
		return {
			company: company || "A Minha Empresa",
			name: "ACC-SINV-2026-00099",
			posting_date: "2026-08-11", posting_time: "20:45:00",
			items: items && items.length ? items : [
				{ item_name: "Cerveja", qty: 2, rate: 1.5, amount: 3.0 },
				{ item_name: "Bifana", qty: 1, rate: 3.5, amount: 3.5 },
			],
			grand_total: 6.5, paid_amount: 6.5,
		};
	}

	return { loadCfg, saveCfg, setLogo, renderReceipt, printReceipt, money, sampleDoc, DEFAULT_CFG, hasBluetooth: !!navigator.bluetooth };
})();
