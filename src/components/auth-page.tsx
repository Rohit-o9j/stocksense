import { useState, type FormEvent } from "react";
import { Boxes, Eye, EyeOff, ArrowLeft, Mail, Loader2 } from "lucide-react";
import { Toaster, toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import illustration from "@/assets/auth-illustration.png";

type View = "signin" | "signup" | "forgot" | "reset";

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong. Try again.";
}

export function AuthPage() {
  const { signIn, signUp, requestPasswordOtp, resetPassword } = useAuth();

  const [view, setView] = useState<View>("signin");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  /** Carried from the forgot step into the reset step. */
  const [resetEmail, setResetEmail] = useState("");

  const changeView = (next: View) => {
    setView(next);
    setError("");
    setNotice("");
    setShowPassword(false);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    const values = new FormData(form);
    const read = (field: string) => String(values.get(field) ?? "");

    setBusy(true);
    setError("");
    setNotice("");

    try {
      if (view === "signin") {
        await signIn(read("email"), read("password"));
        toast.success("Signed in");
        // The session gate in __root redirects once the user is known.
      } else if (view === "signup") {
        // Role is assigned by the server, never requested by the client.
        await signUp({
          name: read("name"),
          email: read("email"),
          password: read("password"),
        });
        toast.success("Account created");
      } else if (view === "forgot") {
        const email = read("email");
        const result = await requestPasswordOtp(email);
        setResetEmail(email);
        setView("reset");
        setNotice(
          result.devCode === undefined
            ? "If that address has an account, a 6 digit code is on its way."
            : `No mail provider is configured, so here is the code: ${result.devCode}`,
        );
      } else {
        await resetPassword({
          email: resetEmail,
          code: read("code"),
          password: read("password"),
        });
        toast.success("Password updated");
        setView("signin");
        setNotice("Your password was updated. Sign in with the new one.");
      }
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  };

  const heading =
    view === "signin"
      ? "Welcome back"
      : view === "signup"
        ? "Create an account"
        : view === "forgot"
          ? "Forgot password?"
          : "Enter your code";

  const subheading =
    view === "signin"
      ? "Please enter your details"
      : view === "signup"
        ? "Enter your details to get started"
        : view === "forgot"
          ? "Enter your email address and we will send a 6 digit code"
          : `Code sent for ${resetEmail}`;

  const submitLabel =
    view === "signin"
      ? "Sign in"
      : view === "signup"
        ? "Sign up"
        : view === "forgot"
          ? "Send code"
          : "Update password";

  return (
    <div className="grid min-h-dvh bg-card text-foreground font-auth md:h-dvh md:grid-cols-2 md:overflow-hidden">
      <section
        className="flex min-h-[680px] flex-col bg-card px-7 py-7 sm:px-12 md:min-h-0 md:overflow-y-auto lg:px-16"
        aria-label="StockSense account"
      >
        <span className="inline-flex w-fit items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground">
            <Boxes className="size-[19px]" strokeWidth={2.1} />
          </span>
          <span className="auth-wordmark text-[23px] font-bold leading-none text-foreground">
            StockSense
          </span>
        </span>

        <div className="flex flex-1 items-center justify-center py-12">
          <div className="w-full max-w-[304px]">
            {view !== "signin" && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => changeView("signin")}
                className="-ml-2 mb-6 h-8 px-2 text-muted-foreground"
              >
                <ArrowLeft className="size-4" /> Back to sign in
              </Button>
            )}

            <h1 className="text-[32px] font-bold leading-tight text-foreground">{heading}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{subheading}</p>

            {error && (
              <p
                role="alert"
                className="mt-6 rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-xs text-danger"
              >
                {error}
              </p>
            )}

            <form key={view} onSubmit={handleSubmit} className="mt-7 space-y-4">
              {view === "signup" && (
                <div>
                  <label htmlFor="auth-name" className="mb-1.5 block text-[13px] font-semibold">
                    Full name
                  </label>
                  <input
                    id="auth-name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    required
                    placeholder="Your name"
                    className="auth-input"
                  />
                </div>
              )}

              {view !== "reset" && (
                <div>
                  <label htmlFor="auth-email" className="mb-1.5 block text-[13px] font-semibold">
                    Email address
                  </label>
                  <input
                    id="auth-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="Enter your email"
                    className="auth-input"
                  />
                </div>
              )}

              {view === "signup" && (
                <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  New accounts start as Warehouse Staff. An Inventory Manager can promote you once
                  you are signed up.
                </p>
              )}

              {view === "reset" && (
                <div>
                  <label htmlFor="auth-code" className="mb-1.5 block text-[13px] font-semibold">
                    6 digit code
                  </label>
                  <input
                    id="auth-code"
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="\d{6}"
                    maxLength={6}
                    required
                    placeholder="123456"
                    className="auth-input tracking-[0.4em]"
                  />
                </div>
              )}

              {view !== "forgot" && (
                <div>
                  <label htmlFor="auth-password" className="mb-1.5 block text-[13px] font-semibold">
                    {view === "reset" ? "New password" : "Password"}
                  </label>
                  <div className="relative">
                    <input
                      id="auth-password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete={view === "signin" ? "current-password" : "new-password"}
                      required
                      minLength={8}
                      placeholder={
                        view === "signin" ? "Enter your password" : "At least 8 characters"
                      }
                      className="auth-input pr-11"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowPassword((value) => !value)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                      className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:bg-transparent hover:text-foreground"
                    >
                      {showPassword ? <EyeOff /> : <Eye />}
                    </Button>
                  </div>
                </div>
              )}

              {view === "signin" && (
                <div className="flex items-center justify-end pt-0.5 text-xs">
                  <Button
                    type="button"
                    variant="link"
                    onClick={() => changeView("forgot")}
                    className="h-auto shrink-0 p-0 text-xs font-semibold text-primary"
                  >
                    Forgot password
                  </Button>
                </div>
              )}

              <div className="pt-2">
                <Button
                  type="submit"
                  disabled={busy}
                  className="h-11 w-full rounded-md text-sm font-semibold active:scale-[.99]"
                >
                  {busy && <Loader2 className="size-4 animate-spin" />}
                  {busy ? "Working…" : submitLabel}
                </Button>
              </div>
            </form>

            {notice && (
              <p
                role="status"
                className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"
              >
                <Mail className="mt-0.5 size-4 shrink-0" />
                {notice}
              </p>
            )}

            {view === "signin" && (
              <p className="mt-8 text-center text-[13px] text-muted-foreground">
                Don&apos;t have an account?{" "}
                <Button
                  type="button"
                  variant="link"
                  onClick={() => changeView("signup")}
                  className="h-auto p-0 text-[13px] font-semibold text-primary underline underline-offset-2"
                >
                  Sign up
                </Button>
              </p>
            )}

            {view === "signup" && (
              <p className="mt-8 text-center text-[13px] text-muted-foreground">
                Already have an account?{" "}
                <Button
                  type="button"
                  variant="link"
                  onClick={() => changeView("signin")}
                  className="h-auto p-0 text-[13px] font-semibold text-primary underline underline-offset-2"
                >
                  Sign in
                </Button>
              </p>
            )}
          </div>
        </div>
      </section>

      <aside
        className="relative min-h-[360px] overflow-hidden bg-auth-visual md:min-h-0"
        aria-label="Illustration of a person working at a laptop"
      >
        <img
          src={illustration}
          width={1024}
          height={1280}
          alt="A person working on a laptop, surrounded by communication icons"
          className="absolute inset-0 h-full w-full object-cover object-center"
        />
      </aside>

      <div aria-live="polite">
        <Toaster position="bottom-right" />
      </div>
    </div>
  );
}
