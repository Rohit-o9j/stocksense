import { useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { Boxes, Eye, EyeOff, ArrowLeft, Mail } from 'lucide-react';
import { toast, Toaster } from 'sonner';
import { Button } from '@/components/ui/button';
import illustration from '@/assets/auth-illustration.jpg';

type View = 'signin' | 'signup' | 'forgot';

function GoogleMark() {
  return <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.7-.06-1.39-.18-2.05H12v3.87h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.32 2.98-7.35Z"/><path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.42l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.41 13.91a6 6 0 0 1 0-3.82V7.5H3.07a10 10 0 0 0 0 9l3.34-2.59Z"/><path fill="#EA4335" d="M12 5.97c1.47 0 2.79.5 3.82 1.5l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.5l3.34 2.59C7.2 7.73 9.4 5.97 12 5.97Z"/></svg>;
}

export function AuthPage() {
  const [view, setView] = useState<View>('signin');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [notice, setNotice] = useState('');

  const changeView = (next: View) => { setView(next); setNotice(''); setShowPassword(false); };
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    if (view === 'forgot') {
      setNotice('This is a design preview. No reset email was sent.');
    } else if (view === 'signup') {
      setNotice('This is a design preview. No account was created.');
    } else {
      setNotice('This is a design preview. No account was signed in.');
    }
  };

  return <div className="grid min-h-dvh bg-card text-foreground font-auth md:h-dvh md:grid-cols-2 md:overflow-hidden">
    <section className="flex min-h-[680px] flex-col bg-card px-7 py-7 sm:px-12 md:min-h-0 md:overflow-y-auto lg:px-16" aria-label="StockSense account">
      <Link to="/" className="inline-flex w-fit items-center gap-2.5 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary" aria-label="StockSense home">
        <span className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground"><Boxes className="size-[19px]" strokeWidth={2.1}/></span>
        <span className="auth-wordmark text-[23px] font-bold leading-none text-foreground">StockSense</span>
      </Link>

      <div className="flex flex-1 items-center justify-center py-12">
        <div className="w-full max-w-[304px]">
          {view !== 'signin' && <Button type="button" variant="ghost" onClick={() => changeView('signin')} className="-ml-2 mb-6 h-8 px-2 text-muted-foreground"><ArrowLeft className="size-4"/> Back to sign in</Button>}
          <h1 className="text-[32px] font-bold leading-tight text-foreground">{view === 'signin' ? 'Welcome back' : view === 'signup' ? 'Create an account' : 'Forgot password?'}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{view === 'signin' ? 'Please enter your details' : view === 'signup' ? 'Enter your details to get started' : 'Enter your email address to reset your password'}</p>

          <form key={view} onSubmit={handleSubmit} className="mt-9 space-y-4">
            {view === 'signup' && <div><label htmlFor="auth-name" className="mb-1.5 block text-[13px] font-semibold">Full name</label><input id="auth-name" name="name" type="text" autoComplete="name" required placeholder="Your name" className="auth-input"/></div>}
            <div><label htmlFor="auth-email" className="mb-1.5 block text-[13px] font-semibold">Email address</label><input id="auth-email" name="email" type="email" autoComplete="email" required placeholder="Enter your email" className="auth-input"/></div>
            {view !== 'forgot' && <div><label htmlFor="auth-password" className="mb-1.5 block text-[13px] font-semibold">Password</label><div className="relative"><input id="auth-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={view === 'signin' ? 'current-password' : 'new-password'} required minLength={8} placeholder="Enter your password" className="auth-input pr-11"/><Button type="button" variant="ghost" size="icon" onClick={() => setShowPassword(x => !x)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:bg-transparent hover:text-foreground">{showPassword ? <EyeOff/> : <Eye/>}</Button></div></div>}
            {view === 'signin' && <div className="flex items-center justify-between gap-2 pt-0.5 text-xs"><label className="flex cursor-pointer items-center gap-2 whitespace-nowrap font-medium"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} className="size-4 accent-primary"/>Remember for 30 days</label><Button type="button" variant="link" onClick={() => changeView('forgot')} className="h-auto shrink-0 p-0 text-xs font-semibold text-primary">Forgot password</Button></div>}
            <div className="space-y-3 pt-2"><Button type="submit" className="h-11 w-full rounded-md text-sm font-semibold active:scale-[.99]">{view === 'signin' ? 'Sign in' : view === 'signup' ? 'Sign up' : 'Send reset link'}</Button>
              {view === 'signin' && <Button type="button" variant="outline" className="h-11 w-full rounded-md border-input bg-card font-semibold text-foreground shadow-none active:scale-[.99]" onClick={() => toast.info('Google sign-in is unavailable in this design preview.')}><GoogleMark/>Sign in with Google</Button>}
            </div>
          </form>
          {notice && <p role="status" className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><Mail className="mt-0.5 size-4 shrink-0"/>{notice}</p>}
          {view === 'signin' && <p className="mt-8 text-center text-[13px] text-muted-foreground">Don&apos;t have an account? <Button type="button" variant="link" onClick={() => changeView('signup')} className="h-auto p-0 text-[13px] font-semibold text-primary underline underline-offset-2">Sign up</Button></p>}
          {view === 'signup' && <p className="mt-8 text-center text-[13px] text-muted-foreground">Already have an account? <Button type="button" variant="link" onClick={() => changeView('signin')} className="h-auto p-0 text-[13px] font-semibold text-primary underline underline-offset-2">Sign in</Button></p>}
        </div>
      </div>
    </section>
    <aside className="relative min-h-[360px] overflow-hidden bg-auth-visual md:min-h-0" aria-label="Illustration of a person working at a laptop">
      <img src={illustration} width={1024} height={1280} alt="A person working on a laptop, surrounded by communication icons" className="absolute inset-0 h-full w-full object-cover object-center"/>
    </aside>
    <div aria-live="polite"><Toaster position="bottom-right"/></div>
  </div>;
}