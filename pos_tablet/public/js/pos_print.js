// pos_print.js — render + impressão do recibo (partilhado entre /pos e /pos-print).
// Impressora Tronic 5890 / "Mini Pocket Printer" (BLE, raster). Web Bluetooth.
window.POSPrint = (function () {
	"use strict";
	const SERVICE = 0xff00, CHAR_WRITE = 0xff02, CHAR_NOTIFY = 0xff01, WIDTH = 384, BPR = 48;
	const CFG_KEY = "pt_print_cfg";
	const DEFAULT_CFG = { header: "", footer: "Obrigado!", showDate: true, showInvoice: true, density: 1, scale: 1 };
	let device = null, server = null, writeChar = null, done = false;
	const sleep = ms => new Promise(r => setTimeout(r, ms));
	const money = n => (Number(n) || 0).toFixed(2).replace(".", ",") + " €";

	function loadCfg() {
		try { return Object.assign({}, DEFAULT_CFG, JSON.parse(localStorage.getItem(CFG_KEY) || "{}")); }
		catch (e) { return Object.assign({}, DEFAULT_CFG); }
	}
	function saveCfg(c) { localStorage.setItem(CFG_KEY, JSON.stringify(c)); }

	// ---- render do recibo → devolve {canvas, bits, h} ----
	function renderReceipt(doc, cfg) {
		cfg = cfg || loadCfg();
		const s = Math.max(0.7, Math.min(1.6, Number(cfg.scale) || 1));
		const MAXH = 6000, PAD = 8;
		const c = document.createElement("canvas"); c.width = WIDTH; c.height = MAXH;
		const ctx = c.getContext("2d");
		ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, WIDTH, MAXH);
		ctx.fillStyle = "#000"; ctx.textBaseline = "top";
		let y = PAD;
		const ce = (t, sz, b) => { ctx.font = (b ? "bold " : "") + Math.round(sz * s) + "px monospace"; ctx.textAlign = "center"; ctx.fillText(t || "", WIDTH / 2, y); y += Math.round(sz * s) + 5; };
		const lf = (t, sz, b) => { ctx.font = (b ? "bold " : "") + Math.round(sz * s) + "px monospace"; ctx.textAlign = "left"; ctx.fillText(t || "", 6, y); y += Math.round(sz * s) + 5; };
		const lr = (l, r, sz, b) => { ctx.font = (b ? "bold " : "") + Math.round(sz * s) + "px monospace"; ctx.textAlign = "left"; ctx.fillText(l || "", 6, y); ctx.textAlign = "right"; ctx.fillText(r || "", WIDTH - 6, y); y += Math.round(sz * s) + 5; };
		const hr = () => { y += 3; ctx.fillRect(6, y, WIDTH - 12, 2); y += 9; };

		ce(doc.company, 26, true);
		if (cfg.header) String(cfg.header).split("\n").forEach(l => ce(l, 15, false));
		ce("Recibo Simplificado", 18, false);
		hr();
		if (cfg.showInvoice && doc.name) lf(doc.name, 16, false);
		if (cfg.showDate) { const w = ((doc.posting_date || "") + " " + (doc.posting_time || "")).trim(); if (w) lf(w, 16, false); }
		if ((cfg.showInvoice && doc.name) || cfg.showDate) hr();
		(doc.items || []).forEach(it => {
			lr((it.qty || 0) + "x " + String(it.item_name || "").substring(0, 20), money(it.amount != null ? it.amount : (it.qty * it.rate)), 20, false);
		});
		hr();
		lr("TOTAL", money(doc.grand_total), 28, true);
		if (doc.paid_amount != null) lr("Pago", money(doc.paid_amount), 18, false);
		if (cfg.footer) { hr(); String(cfg.footer).split("\n").forEach(l => ce(l, 20, true)); }
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

	// imprime doc; onStatus(txt) opcional para feedback
	async function printReceipt(doc, cfg, onStatus) {
		cfg = cfg || loadCfg();
		const st = onStatus || function () {};
		if (!navigator.bluetooth) throw new Error("Sem Web Bluetooth");
		st("A ligar…"); await connect();
		st("A imprimir…");
		const dens = Math.max(0, Math.min(2, Number(cfg.density)));
		await writeChunks(new Uint8Array([0x10, 0xFF, 0x10, 0x00, dens]));  // densidade
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

	return { loadCfg, saveCfg, renderReceipt, printReceipt, money, sampleDoc, DEFAULT_CFG, hasBluetooth: !!navigator.bluetooth };
})();
