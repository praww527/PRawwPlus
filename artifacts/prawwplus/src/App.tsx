import { lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@workspace/auth-web";
import { initTheme } from "@/hooks/useTheme";
import { ErrorBoundary } from "@/components/ErrorBoundary";

import { Layout } from "@/components/Layout";
import { LoadingScreen } from "@/components/ui/spinner";
import { CallProvider, useCall } from "@/context/CallContext";
import { VertoInit } from "@/components/VertoInit";
import { SipInit } from "@/components/SipInit";

// ── Lazy-loaded pages — each route becomes its own JS chunk ────────────────
const Home             = lazy(() => import("@/pages/Home"));
const LoginPage        = lazy(() => import("@/pages/LoginPage"));
const SignUp           = lazy(() => import("@/pages/SignUp"));
const VerifyEmail      = lazy(() => import("@/pages/VerifyEmail"));
const ForgotPassword   = lazy(() => import("@/pages/ForgotPassword"));
const ResetPassword    = lazy(() => import("@/pages/ResetPassword"));
const DialPad          = lazy(() => import("@/pages/DialPad"));
const CallHistory      = lazy(() => import("@/pages/CallHistory"));
const Contacts         = lazy(() => import("@/pages/Contacts"));
const Profile          = lazy(() => import("@/pages/Profile"));
const Admin            = lazy(() => import("@/pages/Admin"));
const AdminDashboard   = lazy(() => import("@/pages/AdminDashboard"));
const PlatformHealth   = lazy(() => import("@/pages/PlatformHealth"));
const ResellerDashboard= lazy(() => import("@/pages/ResellerDashboard"));
const CallingScreen    = lazy(() => import("@/pages/CallingScreen"));
const IncomingCallScreen = lazy(() => import("@/pages/IncomingCallScreen"));
const BuyNumber        = lazy(() => import("@/pages/BuyNumber"));
const NotificationsPage= lazy(() => import("@/pages/NotificationsPage"));
const CallSettingsPage = lazy(() => import("@/pages/CallSettingsPage"));
const VoicemailPage    = lazy(() => import("@/pages/Voicemail"));
const Favorites        = lazy(() => import("@/pages/Favorites"));
const CompliancePage   = lazy(() => import("@/pages/CompliancePage"));
const DiagnosticsPage  = lazy(() => import("@/pages/DiagnosticsPage"));
const RecordingsPage   = lazy(() => import("@/pages/RecordingsPage"));
const IvrPage          = lazy(() => import("@/pages/IvrPage"));
const QueuesPage       = lazy(() => import("@/pages/QueuesPage"));
const ConferencesPage  = lazy(() => import("@/pages/ConferencesPage"));
const NumbersPage      = lazy(() => import("@/pages/NumbersPage"));
const RingGroupsPage   = lazy(() => import("@/pages/admin/RingGroups"));
const CdrPage          = lazy(() => import("@/pages/CdrPage"));
const BillingPage      = lazy(() => import("@/pages/BillingPage"));
const TeamPage         = lazy(() => import("@/pages/TeamPage"));
const JoinTeamPage     = lazy(() => import("@/pages/JoinTeamPage"));
const NotFound         = lazy(() => import("@/pages/not-found"));

initTheme();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function PageFallback() {
  return <div className="flex items-center justify-center h-48 text-white/30 text-sm">Loading…</div>;
}

function ProtectedRoute({ component: Component, componentProps }: { component: React.ComponentType<any>; componentProps?: Record<string, any> }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) return <Redirect to="/login" />;

  return (
    <Layout>
      <Suspense fallback={<PageFallback />}>
        <Component {...(componentProps ?? {})} />
      </Suspense>
    </Layout>
  );
}

function AdminRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) return <Redirect to="/login" />;

  if (!user?.isAdmin) {
    return (
      <Layout>
        <div className="glass rounded-2xl border border-white/10 p-12 text-center max-w-md mx-auto mt-12">
          <h2 className="text-2xl font-bold mb-2 text-red-400">Access Denied</h2>
          <p className="text-white/50">You do not have administrative privileges.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <Suspense fallback={<PageFallback />}>
        <Component />
      </Suspense>
    </Layout>
  );
}

function ResellerRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) return <Redirect to="/login" />;

  if (user?.isAdmin) {
    return (
      <Layout>
        <Suspense fallback={<PageFallback />}>
          <Component />
        </Suspense>
      </Layout>
    );
  }

  if (user?.role !== "reseller") {
    return (
      <Layout>
        <div className="glass rounded-2xl border border-white/10 p-12 text-center max-w-md mx-auto mt-12">
          <h2 className="text-2xl font-bold mb-2 text-red-400">Access Denied</h2>
          <p className="text-white/50">Reseller access is required to view this page.</p>
        </div>
      </Layout>
    );
  }

  if (!user?.approved) {
    return (
      <Layout>
        <div className="glass rounded-2xl border border-white/10 p-12 text-center max-w-md mx-auto mt-12">
          <h2 className="text-2xl font-bold mb-2 text-amber-400">Pending Approval</h2>
          <p className="text-white/50">Your reseller account is awaiting admin approval. You will be notified once approved.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <Suspense fallback={<PageFallback />}>
        <Component />
      </Suspense>
    </Layout>
  );
}

function PublicRoute({ component: Component }: { component: React.ComponentType }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <LoadingScreen />;
  if (isAuthenticated) return <Redirect to="/dashboard" />;

  return (
    <Suspense fallback={<PageFallback />}>
      <Component />
    </Suspense>
  );
}

function CallOverlays() {
  const { callState } = useCall();
  if (callState === "outgoing" || callState === "active") {
    return (
      <Suspense fallback={null}>
        <CallingScreen />
      </Suspense>
    );
  }
  if (callState === "incoming") {
    return (
      <Suspense fallback={null}>
        <IncomingCallScreen />
      </Suspense>
    );
  }
  return null;
}

/**
 * Mounts VertoInit and SipInit at the App level — outside the router — so
 * they are never torn down and re-created when the user navigates between pages.
 *
 * Previously these lived inside Layout, which unmounts on every route change
 * (because each route uses an inline arrow function as its `component` prop,
 * creating a new React component type on every render).  That caused the SIP
 * and Verto WebSocket connections to disconnect and reconnect on every
 * navigation, and calls that arrived during the reconnection window were lost.
 *
 * Only rendered while the user is authenticated so we never attempt to fetch
 * SIP/Verto config before a session exists.
 */
function CallConnector() {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return null;
  return (
    <>
      <VertoInit />
      <SipInit />
    </>
  );
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
      <Route path="/verify-email"    component={() => <Suspense fallback={<PageFallback />}><VerifyEmail /></Suspense>} />
      <Route path="/forgot-password" component={() => <PublicRoute   component={ForgotPassword} />} />
      <Route path="/reset-password"  component={() => <Suspense fallback={<PageFallback />}><ResetPassword /></Suspense>} />
      <Route path="/dashboard"       component={() => <ProtectedRoute component={DialPad} />} />
      <Route path="/calls"           component={() => <ProtectedRoute component={CallHistory} />} />
      <Route path="/voicemail"       component={() => <ProtectedRoute component={VoicemailPage} />} />
      <Route path="/contacts"        component={() => <ProtectedRoute component={Contacts} />} />
      <Route path="/favorites"       component={() => <ProtectedRoute component={Favorites} />} />
      <Route path="/profile"         component={() => <ProtectedRoute component={Profile} />} />
      <Route path="/buy-number"      component={BuyNumberRoute} />
      <Route path="/notifications"   component={() => <ProtectedRoute component={NotificationsPage} />} />
      <Route path="/call-settings"   component={() => <ProtectedRoute component={CallSettingsPage} />} />
      <Route path="/numbers"         component={() => <ProtectedRoute component={NumbersPage} />} />
      <Route path="/recordings"      component={() => <ProtectedRoute component={RecordingsPage} />} />
      <Route path="/ivr"             component={() => <ProtectedRoute component={IvrPage} />} />
      <Route path="/queues"          component={() => <ProtectedRoute component={QueuesPage} />} />
      <Route path="/conferences"     component={() => <ProtectedRoute component={ConferencesPage} />} />
      <Route path="/cdr"             component={() => <ProtectedRoute component={CdrPage} />} />
      <Route path="/billing"         component={() => <ProtectedRoute component={BillingPage} />} />
      <Route path="/team"            component={() => <ProtectedRoute component={TeamPage} />} />
      <Route path="/team/join"       component={() => <Suspense fallback={<PageFallback />}><JoinTeamPage /></Suspense>} />
      <Route path="/compliance"      component={() => <ProtectedRoute component={CompliancePage} />} />
      <Route path="/diagnostics"     component={() => <ProtectedRoute component={DiagnosticsPage} />} />
      <Route path="/admin/platform-health" component={() => <AdminRoute component={PlatformHealth} />} />
      <Route path="/admin/dashboard"  component={() => <AdminRoute    component={AdminDashboard} />} />
      <Route path="/admin/ring-groups" component={() => <AdminRoute   component={RingGroupsPage} />} />
      <Route path="/admin"           component={() => <AdminRoute     component={Admin} />} />
      <Route path="/reseller"        component={() => <ResellerRoute  component={ResellerDashboard} />} />
      <Route component={() => <Suspense fallback={<PageFallback />}><NotFound /></Suspense>} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <CallProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <CallConnector />
              <Router />
              <CallOverlays />
            </WouterRouter>
            <Toaster />
          </CallProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
