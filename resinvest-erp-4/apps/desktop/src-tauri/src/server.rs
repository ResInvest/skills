//! Adres serwera firmowego: walidacja i porównanie „czy ten adres należy do serwera ERP”.
//! Czyste funkcje (bez okien) — testowane jednostkowo.

use url::Url;

/// Adres wpisany przez użytkownika → źródło serwera (`https://host[:port]/`).
/// Reguły: domyślnie https; http tylko dla komputera lokalnego (testy); bez loginu / hasła w adresie;
/// ścieżka, zapytanie i kotwica są pomijane — aplikacja zawsze startuje od strony głównej serwera.
pub fn normalize(input: &str) -> Result<Url, String> {
    let raw = input.trim();
    if raw.is_empty() {
        return Err("Podaj adres serwera ResInvest ERP, np. https://erp.resinvest.group".into());
    }
    let with_scheme = if raw.contains("://") { raw.to_string() } else { format!("https://{raw}") };
    let url = Url::parse(&with_scheme).map_err(|_| format!("Nieprawidłowy adres: {raw}"))?;
    let host = url.host_str().ok_or_else(|| "Adres musi zawierać nazwę serwera".to_string())?.to_string();
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Adres nie może zawierać loginu ani hasła".into());
    }
    let local = host == "localhost" || host == "127.0.0.1" || host == "[::1]";
    match url.scheme() {
        "https" => {}
        "http" if local => {}
        "http" => return Err("Połączenie z serwerem firmy musi być szyfrowane — użyj adresu https://".into()),
        other => return Err(format!("Nieobsługiwany protokół: {other}")),
    }
    let mut origin = Url::parse(&format!("{}://{}", url.scheme(), host)).map_err(|e| e.to_string())?;
    origin.set_port(url.port()).map_err(|_| "Nieprawidłowy port".to_string())?;
    Ok(origin)
}

/// Czy adres należy do serwera ERP (ten sam protokół, host i port) — tylko takie strony otwiera okno aplikacji.
pub fn same_origin(server: &Url, target: &Url) -> bool {
    server.scheme() == target.scheme() && server.host_str() == target.host_str() && server.port_or_known_default() == target.port_or_known_default()
}

/// Adres z parametru uruchomienia (`--server=…` albo `--server …`) — wdrożenie przez dział IT.
pub fn from_args<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    let mut it = args.into_iter();
    while let Some(a) = it.next() {
        if let Some(v) = a.strip_prefix("--server=") {
            return Some(v.to_string());
        }
        if a == "--server" {
            return it.next();
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_to_https_origin() {
        assert_eq!(normalize("erp.resinvest.group").unwrap().as_str(), "https://erp.resinvest.group/");
        assert_eq!(normalize("  https://erp.resinvest.group:8443/dokumenty?x=1#a ").unwrap().as_str(), "https://erp.resinvest.group:8443/");
        assert_eq!(normalize("http://localhost:4180").unwrap().as_str(), "http://localhost:4180/");
    }

    #[test]
    fn rejects_unsafe_addresses() {
        assert!(normalize("").unwrap_err().contains("Podaj adres"));
        assert!(normalize("http://erp.resinvest.group").unwrap_err().contains("szyfrowane"));
        assert!(normalize("https://jan:haslo@erp.resinvest.group").unwrap_err().contains("loginu"));
        assert!(normalize("ftp://erp.resinvest.group").unwrap_err().contains("protokół"));
        assert!(normalize("https://").is_err());
    }

    #[test]
    fn same_origin_only_for_erp_server() {
        let s = normalize("erp.resinvest.group").unwrap();
        assert!(same_origin(&s, &Url::parse("https://erp.resinvest.group/stany?x=1").unwrap()));
        assert!(same_origin(&s, &Url::parse("https://erp.resinvest.group:443/").unwrap()));
        assert!(!same_origin(&s, &Url::parse("http://erp.resinvest.group/").unwrap()));
        assert!(!same_origin(&s, &Url::parse("https://erp.resinvest.group.evil.example/").unwrap()));
        assert!(!same_origin(&s, &Url::parse("https://www.google.com/").unwrap()));
    }

    #[test]
    fn reads_server_from_arguments() {
        let v = |a: &[&str]| from_args(a.iter().map(|s| s.to_string()));
        assert_eq!(v(&["app.exe", "--server=https://erp.firma"]), Some("https://erp.firma".into()));
        assert_eq!(v(&["app.exe", "--server", "erp.firma"]), Some("erp.firma".into()));
        assert_eq!(v(&["app.exe"]), None);
    }
}
