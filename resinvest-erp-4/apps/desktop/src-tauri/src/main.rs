// Bez okna konsoli w wersji wydanej (Windows).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    resinvest_erp_desktop::run();
}
