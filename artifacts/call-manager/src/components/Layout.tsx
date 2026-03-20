import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { 
  Phone, 
  LayoutDashboard, 
  History, 
  CreditCard, 
  Wallet, 
  ShieldAlert,
  LogOut,
  Menu,
  X
} from "lucide-react";
import { cn } from "@/lib/utils";

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/calls/new", label: "Make Call", icon: Phone },
    { href: "/calls", label: "Call History", icon: History },
    { href: "/subscription", label: "Subscription", icon: CreditCard },
    { href: "/credits", label: "Top Up Credits", icon: Wallet },
  ];

  if (user?.isAdmin) {
    navItems.push({ href: "/admin", label: "Admin Panel", icon: ShieldAlert });
  }

  const toggleMenu = () => setMobileMenuOpen(!mobileMenuOpen);
  const closeMenu = () => setMobileMenuOpen(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-16 glass z-40 flex items-center justify-between px-4 border-b-0 rounded-none">
        <div className="flex items-center gap-2 text-white font-display font-bold text-lg tracking-wide">
          <Phone className="h-5 w-5 text-primary" />
          CallManager
        </div>
        <button onClick={toggleMenu} className="text-white/70 hover:text-white">
          {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-30 w-72 glass border-r-0 border-l-0 border-y-0 rounded-none transform transition-transform duration-300 ease-in-out lg:relative lg:translate-x-0 flex flex-col",
        mobileMenuOpen ? "translate-x-0 mt-16 lg:mt-0" : "-translate-x-full"
      )}>
        <div className="p-6 hidden lg:flex items-center gap-3 text-white font-display font-bold text-xl tracking-wide">
          <div className="w-10 h-10 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center">
            <Phone className="h-5 w-5 text-primary" />
          </div>
          CallManager<span className="text-primary text-2xl leading-none">.</span>
        </div>

        <div className="flex-1 overflow-y-auto py-6 lg:py-2 px-4 space-y-1">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link 
                key={item.href} 
                href={item.href}
                onClick={closeMenu}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all duration-200 group",
                  isActive 
                    ? "bg-primary/10 text-primary border border-primary/20" 
                    : "text-white/60 hover:bg-white/5 hover:text-white"
                )}
              >
                <item.icon className={cn("h-5 w-5 transition-colors", isActive ? "text-primary" : "text-white/40 group-hover:text-white/70")} />
                {item.label}
              </Link>
            );
          })}
        </div>

        {/* User Profile Footer */}
        <div className="p-4 mt-auto">
          <div className="glass rounded-2xl p-4 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <img 
                src={`${import.meta.env.BASE_URL}images/avatar-placeholder.png`}
                alt="User"
                className="w-10 h-10 rounded-full object-cover border border-white/20"
              />
              <div className="overflow-hidden">
                <p className="text-sm font-semibold text-white truncate">{user?.name || user?.username}</p>
                <p className="text-xs text-white/50 truncate uppercase tracking-wider">{user?.isAdmin ? 'Administrator' : 'Standard User'}</p>
              </div>
            </div>
            <button 
              onClick={logout}
              className="flex items-center justify-center gap-2 w-full py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white text-sm font-medium transition-colors border border-white/5 hover:border-white/10"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto relative lg:mt-0 mt-16 scroll-smooth">
        <div className="absolute inset-0 z-0">
          <img 
            src={`${import.meta.env.BASE_URL}images/bg-abstract.png`}
            alt=""
            className="w-full h-full object-cover opacity-50"
          />
          <div className="absolute inset-0 bg-background/80 backdrop-blur-[100px]" />
        </div>
        <div className="relative z-10 max-w-6xl mx-auto p-4 md:p-8 min-h-full">
          {children}
        </div>
      </main>

      {/* Mobile backdrop */}
      {mobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-20 lg:hidden"
          onClick={closeMenu}
        />
      )}
    </div>
  );
}
