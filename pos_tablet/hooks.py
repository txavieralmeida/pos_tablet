app_name = "pos_tablet"
app_title = "POS Tablet"
app_publisher = "Grupo Desportivo do Pião"
app_description = "Suprime o teclado virtual do POS do ERPNext em tablets"
app_email = "tiago.relvas.almeida@devoteam.com"
app_license = "MIT"

# Injeta o script no desk (carrega em todas as páginas do desk, mas só atua no POS).
# Ficheiro estático (sem esbuild) servido a partir de public/js via symlink /assets.
# O ?v=N é cache-busting: bumpar sempre que o JS muda, para o browser buscar a versão nova.
app_include_js = ["/assets/pos_tablet/js/pos_tablet.js?v=3"]
