import { useSession } from "../../auth/session";
import { AuthLayout } from "../auth/AuthLayout";
import { Alert } from "../../ui/components";
import { ChangePasswordForm } from "./ChangePasswordForm";

/** Wymuszona zmiana hasła — do czasu zmiany API odrzuca wszystkie inne operacje (PASSWORD_CHANGE_REQUIRED). */
export function ForcedPasswordPage() {
  const { user, logout } = useSession();
  return (
    <AuthLayout title="Wymagana zmiana hasła" footer={<button type="button" className="btn ghost sm" onClick={() => void logout()}>Wyloguj</button>}>
      <Alert kind="warn">Administrator wymaga ustawienia nowego hasła dla konta <strong>{user?.email}</strong> przed dalszą pracą.</Alert>
      <ChangePasswordForm />
    </AuthLayout>
  );
}
