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

## Requisitos

- Frappe **v15** + ERPNext **v15**
- Python 3.10+
- Um **perfil de POS (POS Profile)** com o utilizador marcado como *default*, com **artigos**
  vendáveis nos grupos de itens do perfil. Sem isto, a página `/pos` mostra uma mensagem a
  indicar o que falta.

## Instalação (bench — como qualquer app ERPNext)

```bash
# 1. Obter a app para o bench (repo privado → precisa de acesso git: SSH ou token)
bench get-app https://github.com/txavieralmeida/pos_tablet --branch master
#   (SSH em alternativa: bench get-app git@github.com:txavieralmeida/pos_tablet.git)

# 2. Instalar num site
bench --site <o-teu-site> install-app pos_tablet

# 3. Compilar assets (JS do app_include_js)
bench build --app pos_tablet

# 4. Migrar (garante hooks/rotas atualizados)
bench --site <o-teu-site> migrate
```

Aceder depois em `https://<o-teu-site>/pos`.

Para **desinstalar**: `bench --site <o-teu-site> uninstall-app pos_tablet`.

## Instalação em Docker (imagem custom)

Em Docker as apps têm de estar **na imagem** (partilhada por todos os serviços). Junta a app
ao build da imagem (ver `../../Dockerfile`) — COPY do código + `pip install -e` — ou usa o
mecanismo `apps.json` do frappe_docker. Depois:

```bash
docker compose up -d                                  # sobe o stack com a imagem custom
docker exec <backend> bench --site <site> install-app pos_tablet
```

Neste servidor a imagem está publicada no registry local `127.0.0.1:5000/erpnext-custom:v15`.

## Configuração pós-instalação

1. **POS Profile**: cria/usa um perfil, define empresa, armazém, lista de preços, cliente
   (ex.: "Cliente Balcão") e métodos de pagamento; em *Applicable for Users* marca o teu
   utilizador como **default**.
2. **Artigos**: garante que há itens vendáveis nos **grupos de itens** do perfil (o filtro
   inclui subgrupos).
3. (Opcional) Impressora Bluetooth: Android/Chrome + impressora BLE Tronic 5890.

## API (`pos_tablet/api.py`)

- `get_pos_items()` — artigos do perfil default, com preço e imagem embebida (base64).
  Devolve `{error, message}` se não houver perfil default ou artigos.
- `create_sale(cart, mode_of_payment)` — cria e submete a Sales Invoice (POS) no perfil default.

## Licença

MIT — ver [LICENSE](LICENSE).
