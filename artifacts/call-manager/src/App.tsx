import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@workspace/replit-auth-web";

import { Layout } from "@/components/Layout";
import { LoadingScreen } from "@/components/ui/spinner";
import NotFound from "@/pages/not-found";

import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import MakeCall from "@/pages/MakeCall";
import CallHistory from "@/pages/CallHistory";
import Subscription from "@/pages/Subscription";
import TopUp from "@/pages/TopUp";
import PaymentHistory from "@/pages/PaymentHistory";
import Admin from "@/pages/Admin";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) return <Login />;

  return (
    <Layout>
      <Component />
    </Layout>
  );
}

function AdminRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) return <Login />;
  
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

  return (
    <Layout>
      <Component />
    </Layout>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={() => <ProtectedRoute component={Dashboard} />} />
      <Route path="/calls/new" component={() => <ProtectedRoute component={MakeCall} />} />
      <Route path="/calls" component={() => <ProtectedRoute component={CallHistory} />} />
      <Route path="/subscription" component={() => <ProtectedRoute component={Subscription} />} />
      <Route path="/credits" component={() => <ProtectedRoute component={TopUp} />} />
      <Route path="/payments" component={() => <ProtectedRoute component={PaymentHistory} />} />
      <Route path="/admin" component={() => <AdminRoute component={Admin} />} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
