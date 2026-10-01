import type { ReactNode } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router";
import { SessionProvider, useSession } from "../auth/session";
import { AuditPage } from "../pages/AuditPage";
import { DashboardPage } from "../pages/DashboardPage";
import { RolesPage } from "../pages/RolesPage";
import { Shell } from "../pages/Shell";
import { AccountPage } from "../pages/account/AccountPage";
import { ForcedPasswordPage } from "../pages/account/ForcedPasswordPage";
import { ForgotPage } from "../pages/auth/ForgotPage";
import { LoginPage } from "../pages/auth/LoginPage";
import { RegisterPage } from "../pages/auth/RegisterPage";
import { TokenPasswordPage } from "../pages/auth/TokenPasswordPage";
import { UserDetailPage } from "../pages/users/UserDetailPage";
import { UsersPage } from "../pages/users/UsersPage";
import { StockPage } from "../pages/stock/StockPage";
import { OpeningPage } from "../pages/stock/OpeningPage";
import { CatalogPage } from "../pages/catalog/CatalogPage";
import { DocumentsPage } from "../pages/documents/DocumentsPage";
import { NewOperationPage } from "../pages/documents/NewOperationPage";
import { ReportsPage } from "../pages/reports/ReportsPage";
import { PlannerPage } from "../pages/planner/PlannerPage";

/** Wymaga zalogowania; przy wymuszonej zmianie hasła pokazuje wyłącznie ekran zmiany hasła. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  const loc = useLocation();
  if (loading) return <div className="splash" role="status">Wczytywanie…</div>;
  if (!user) return <Navigate to="/logowanie" replace state={{ from: loc.pathname + loc.search }} />;
  if (user.mustChangePassword) return <ForcedPasswordPage />;
  return <>{children}</>;
}

/** Ukrywa ekran bez uprawnienia (ochrona właściwa jest w API — tu tylko czytelny komunikat). */
function RequirePerm({ perm, children }: { perm: string; children: ReactNode }) {
  const { can } = useSession();
  return can(perm) ? <>{children}</> : <NoAccess />;
}

function NoAccess() {
  return <section className="card"><h1>Brak uprawnień</h1><p className="muted">Twoja rola nie ma dostępu do tego ekranu. Jeśli to błąd — skontaktuj się z administratorem.</p><Link to="/">Wróć na pulpit</Link></section>;
}
function NotFound() {
  return <section className="card"><h1>Nie znaleziono strony</h1><Link to="/">Wróć na pulpit</Link></section>;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/logowanie" element={<LoginPage />} />
      <Route path="/zapomnialem-hasla" element={<ForgotPage />} />
      <Route path="/reset-hasla" element={<TokenPasswordPage kind="PASSWORD_RESET" />} />
      <Route path="/aktywacja" element={<TokenPasswordPage kind="INVITE" />} />
      <Route path="/rejestracja" element={<RegisterPage />} />
      <Route element={<RequireAuth><Shell /></RequireAuth>}>
        <Route index element={<DashboardPage />} />
        <Route path="konto" element={<AccountPage />} />
        <Route path="stany" element={<RequirePerm perm="report.view"><StockPage /></RequirePerm>} />
        <Route path="dokumenty" element={<RequirePerm perm="report.view"><DocumentsPage /></RequirePerm>} />
        <Route path="nowa-operacja" element={<RequirePerm perm="report.view"><NewOperationPage /></RequirePerm>} />
        <Route path="planer-zakupow" element={<RequirePerm perm="report.view"><PlannerPage /></RequirePerm>} />
        <Route path="raporty" element={<RequirePerm perm="report.view"><ReportsPage /></RequirePerm>} />
        <Route path="kartoteki" element={<Navigate to="/kartoteki/materials" replace />} />
        <Route path="kartoteki/:kind" element={<RequirePerm perm="report.view"><CatalogPage /></RequirePerm>} />
        <Route path="bilans-otwarcia" element={<RequirePerm perm="report.view"><OpeningPage /></RequirePerm>} />
        <Route path="uzytkownicy" element={<RequirePerm perm="users.read"><UsersPage /></RequirePerm>} />
        <Route path="uzytkownicy/:id" element={<RequirePerm perm="users.read"><UserDetailPage /></RequirePerm>} />
        <Route path="role" element={<RequirePerm perm="users.read"><RolesPage /></RequirePerm>} />
        <Route path="audyt" element={<RequirePerm perm="audit.read"><AuditPage /></RequirePerm>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return <BrowserRouter><SessionProvider><AppRoutes /></SessionProvider></BrowserRouter>;
}
