import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@workspace/auth-web";

import { Layout } from "@/components/Layout";
import { LoadingScreen } from "@/components/ui/spinner";
import { CallProvider, useCall } from "@/context/CallContext";

import Home            from "@/pages/Home";
import LoginPage       from "@/pages/LoginPage";
import SignUp          from "@/pages/SignUp";
import VerifyEmail     from "@/pages/VerifyEmail";
import ForgotPassword  from "@/pages/ForgotPassword";
import ResetPassword   from "@/pages/ResetPassword";
import DialPad         from "@/pages/DialPad";
import CallHistory     from "@/pages/CallHistory";
import Contacts        from "@/pages/Contacts";
import Profile         from "@/pages/Profile";
import Admin           from "@/pages/Admin";
import ResellerDashboard from "@/pages/ResellerDashboard";
import CallingScreen      from "@/pages/CallingScreen";
import IncomingCallScreen from "@/pages/IncomingCallScreen";
import BuyNumber          from "@/pages/BuyNumber";
import NotificationsPage  from "@/pages/NotificationsPage";
import CallSettingsPage   from "@/pages/CallSettingsPage";
import VoicemailPage      from "@/pages/Voicemail";
import Favorites          from "@/pages/Favorites";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function ProtectedRoute({ component: Component, componentProps }: { component: React.ComponentType<any>; componentProps?: Record<string, any> }) {
  const { isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) { setLocation("/login"); return null; }

  return <Layout><Component {...(componentProps ?? {})} /></Layout>;
}

function AdminRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) { setLocation("/login"); return null; }

  if (!user?.isAdmin) {
    return (
      <Layout>
        <div className="p-12 text-center text-red-400 glass rounded-2xl">
          <h2 className="text-2xl font-bold mb-2">Access Denied</h2>
          <p>You do not have administrative privileges.</p>
        </div>
      </Layout>
    );
  }

  return <Layout><Component /></Layout>;
}

function ResellerRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) { setLocation("/login"); return null; }

  if (user?.isAdmin) return <Layout><Component /></Layout>;

  if (user?.role !== "reseller") {
    return (
      <Layout>
        <div className="p-12 text-center glass rounded-2xl border border-white/10">
          <h2 className="text-2xl font-bold mb-2 text-red-400">Access Denied</h2>
          <p className="text-white/50">Reseller access is required to view this page.</p>
        </div>
      </Layout>
    );
  }

  if (!user?.approved) {
    return (
      <Layout>
        <div className="p-12 text-center glass rounded-2xl border border-white/10">
          <h2 className="text-2xl font-bold mb-2 text-amber-400">Pending Approval</h2>
          <p className="text-white/50">Your reseller account is awaiting admin approval. You will be notified once approved.</p>
        </div>
      </Layout>
    );
  }

  return <Layout><Component /></Layout>;
}

function PublicRoute({ component: Component }: { component: React.ComponentType }) {
  const { isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  if (isLoading) return <LoadingScreen />;
  if (isAuthenticated) { setLocation("/dashboard"); return null; }

  return <Component />;
}

function CallOverlays() {
  const { callState } = useCall();
  if (callState === "outgoing" || callState === "active") return <CallingScreen />;
  if (callState === "incoming") return <IncomingCallScreen />;
  return null;
}

function BuyNumberRoute() {
  const [location] = useLocation();
  const params = new URLSearchParams(location.split("?")[1] ?? "");
  const mode = (params.get("mode") ?? "buy") as "buy" | "change";
  const oldNumberId = params.get("oldId") ?? undefined;
  const oldNumber = params.get("oldNumber") ?? undefined;
  return (
    <ProtectedRoute
      component={BuyNumber}
      componentProps={{ mode, oldNumberId, oldNumber }}
    />
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/"                component={() => <PublicRoute   component={Home} />} />
      <Route path="/login"           component={() => <PublicRoute   component={LoginPage} />} />
      <Route path="/signup"          component={() => <PublicRoute   component={SignUp} />} />
      <Route path="/verify-email"    component={VerifyEmail} />
      <Route path="/forgot-password" component={() => <PublicRoute   component={ForgotPassword} />} />
      <Route path="/reset-password"  component={ResetPassword} />
      <Route path="/dashboard"       component={() => <ProtectedRoute component={DialPad} />} />
      <Route path="/calls"           component={() => <ProtectedRoute component={CallHistory} />} />
      <Route path="/voicemail"       component={() => <ProtectedRoute component={VoicemailPage} />} />
      <Route path="/contacts"        component={() => <ProtectedRoute component={Contacts} />} />
      <Route path="/favorites"       component={() => <ProtectedRoute component={Favorites} />} />
      <Route path="/profile"         component={() => <ProtectedRoute component={Profile} />} />
      <Route path="/buy-number"      component={BuyNumberRoute} />
      <Route path="/notifications"   component={() => <ProtectedRoute component={NotificationsPage} />} />
      <Route path="/call-settings"   component={() => <ProtectedRoute component={CallSettingsPage} />} />
      <Route path="/numbers"         component={() => <Redirect to="/profile" />} />
      <Route path="/admin"           component={() => <AdminRoute     component={Admin} />} />
      <Route path="/reseller"        component={() => <ResellerRoute  component={ResellerDashboard} />} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <CallProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
            <CallOverlays />
          </WouterRouter>
          <Toaster />
        </CallProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
