import { ToastProvider } from "@/components/ui/toast";

/**
 * The only route group outside the application shell. Pages here are reachable
 * without a session, so they must not render the shell — which fetches company
 * data and the signed-in user.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <div className="auth">{children}</div>
    </ToastProvider>
  );
}
