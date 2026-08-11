# pos_tablet

App Frappe/ERPNext (v15) com melhorias de POS para tablets do Grupo Desportivo do Pião.

## O que faz

1. **POS simplificado** numa página própria em **`/pos`** (`pos_tablet/www/pos.html`):
   grelha de artigos do **perfil de POS default** (filtrada pelos grupos de itens do perfil),
   carrinho com `–/+`, numpad para dinheiro + troco, ícones de pagamento, cancelar venda,
   checkout otimista e impressão do recibo simplificado.
2. **Impressora Bluetooth** (Web Bluetooth) — Tronic 5890 / "Mini Pocket Printer" (BLE, raster).
3. **Melhorias no POS nativo** (`public/js/pos_tablet.js`, via `app_include_js`): suprime o
   teclado virtual em tablets e adiciona botões `–/+` no carrinho.

## API (`pos_tablet/api.py`)

- `get_pos_items()` — artigos do perfil default, com preço e imagem embebida (base64).
- `create_sale(cart, mode_of_payment)` — cria e submete a Sales Invoice (POS) no perfil default.

## Deploy

Baked numa imagem custom do ERPNext (ver `../../Dockerfile`) e publicada no registry local.
O perfil de POS usado é o **default do utilizador** (POS Profile User com `default=1`).
