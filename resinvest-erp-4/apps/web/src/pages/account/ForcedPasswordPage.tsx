import { useSession } from "../../auth/session";
import { AuthLayout } from "../auth/AuthLayout";
import { Alert } from "../../ui/components";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { t } from "../../i18n";

/** Wymuszona zmiana hasła — do czasu zmiany API odrzuca wszystkie inne operacje (PASSWORD_CHANGE_REQUIRED). */
export function ForcedPasswordPage() {
  const { user, logout } = useSession();
  return (
    <AuthLayout title={t("Wymagana zmiana hasła")} footer={<button type="button" className="btn ghost sm" onClick={() => void logout()}>{t("Wyloguj")}</button>}>
      <Alert kind="warn"><span>{t("Administrator wymaga ustawienia nowego hasła dla konta {email} przed dalszą pracą.", { email: user?.email ?? "" })}</span></Alert>
      <ChangePasswordForm />
    </AuthLayout>
  );
}
