import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Coffee, ShieldCheck, User, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/_authenticated/manual")({
  component: ManualPage,
});

type Tab = "admin" | "barista" | "customer";

function ManualPage() {
  const [tab, setTab] = useState<Tab>("admin");

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
      <header className="space-y-1">
        <h1 className="font-display text-2xl sm:text-3xl">User Manual</h1>
        <p className="text-sm text-muted-foreground">
          Quick reference for everyone using Bevi &amp; Go. Use the tabs below.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        <TabBtn active={tab === "admin"} onClick={() => setTab("admin")} icon={<ShieldCheck className="h-4 w-4" />}>
          Admin / Owner
        </TabBtn>
        <TabBtn active={tab === "barista"} onClick={() => setTab("barista")} icon={<Coffee className="h-4 w-4" />}>
          Barista
        </TabBtn>
        <TabBtn active={tab === "customer"} onClick={() => setTab("customer")} icon={<User className="h-4 w-4" />}>
          Customer page
        </TabBtn>
      </div>

      <Card className="p-5 sm:p-7 prose prose-sm max-w-none">
        {tab === "admin" && <AdminGuide />}
        {tab === "barista" && <BaristaGuide />}
        {tab === "customer" && <CustomerGuide />}
      </Card>

      <div className="flex flex-wrap gap-2">
        <a href="/manuals/bevi-go-admin-manual.pdf" target="_blank" rel="noreferrer">
          <Button variant="outline" size="sm">
            <ExternalLink className="h-3.5 w-3.5 mr-1" /> Download Admin PDF
          </Button>
        </a>
        <a href="/manuals/bevi-go-barista-manual.pdf" target="_blank" rel="noreferrer">
          <Button variant="outline" size="sm">
            <ExternalLink className="h-3.5 w-3.5 mr-1" /> Download Barista PDF
          </Button>
        </a>
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Button size="sm" variant={active ? "default" : "outline"} onClick={onClick}>
      <span className="mr-1.5">{icon}</span>{children}
    </Button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="font-display text-lg sm:text-xl text-primary mb-2">{title}</h2>
      <div className="text-sm text-foreground/90 space-y-2 leading-relaxed">{children}</div>
    </section>
  );
}

function AdminGuide() {
  return (
    <>
      <Section title="1. Getting started">
        <p>Sign in with your staff email. Your role (<b>Admin</b> or <b>Developer</b>) unlocks
        the full sidebar. If anything is missing, check <b>Settings → Staff &amp; Roles</b>.</p>
      </Section>
      <Section title="2. Setting up the menu">
        <ol className="list-decimal pl-5 space-y-1">
          <li><b>Catalog → Menu &amp; Recipes</b>: add categories, drinks, and prices. Tag
              categories with <i>Prints label</i> so drink labels print automatically.</li>
          <li>Attach a recipe for each item — used to deduct stock and to restock on refund.</li>
          <li><b>Catalog → Inventory</b>: add raw items (milk, syrups, cups) and set par stock.</li>
          <li><b>Catalog → Bundles</b>: create limited-time combos with a fixed price.</li>
        </ol>
      </Section>
      <Section title="3. Customers &amp; discounts">
        <p>Use <b>Customers → Customers</b> to register a customer. The system creates a
        unique QR/code; share it so they can self-order from their phone. <b>Discounts</b>
        let you build coupons or percentage promos that the POS can apply at checkout.</p>
      </Section>
      <Section title="4. Daily operations">
        <ul className="list-disc pl-5 space-y-1">
          <li><b>Sales → POS</b>: take orders (used mainly by baristas).</li>
          <li><b>Sales → Today's Orders</b>: live list of today's tickets. Reprint, void,
              or refund from here.</li>
          <li><b>Sales → End of Shift</b>: closing summary for the cashier.</li>
          <li><b>Sales → EOS by Date</b>: review any previous shift.</li>
        </ul>
      </Section>
      <Section title="5. Payroll">
        <p><b>Payroll → Timeclock Report</b> shows hours per staff member. <b>Payslip</b>
        generates the period payslip from those hours.</p>
      </Section>
      <Section title="6. Reports">
        <ul className="list-disc pl-5 space-y-1">
          <li><b>Reports → Reports</b>: per-order, per-item, and discount tabs. Filter by
              date or by Order # / Order ID. Export to CSV or push directly to Google Sheets.</li>
          <li><b>Reports → Sales Summary</b>: aggregate view (totals, top sellers).</li>
        </ul>
      </Section>
      <Section title="7. Settings &amp; security">
        <ul className="list-disc pl-5 space-y-1">
          <li><b>Payment Methods</b>: enable cash, card, GCash, etc. Add fees if needed.</li>
          <li><b>Print Settings</b>: choose receipt size, header text, label format.</li>
          <li><b>Staff &amp; Roles</b>: invite by email and assign <i>admin</i> or
              <i>barista</i>. Only developers can add other developers.</li>
          <li><b>Audit Log</b>: every sensitive change is recorded here.</li>
        </ul>
      </Section>
      <Section title="8. Refunds, voids &amp; mistakes">
        <p>Open the order in <b>Today's Orders</b>, then choose <b>Refund</b> or <b>Void</b>.
        Stock is automatically restocked and loyalty points are reversed. Both actions are
        admin-only and appear in the audit log.</p>
      </Section>
    </>
  );
}

function BaristaGuide() {
  return (
    <>
      <Section title="1. Clock in">
        <p>Open <b>Payroll → Timeclock</b> at the start of your shift and tap <b>Clock in</b>.
        Clock out at the end so payroll is accurate.</p>
      </Section>
      <Section title="2. Taking an order at the POS">
        <ol className="list-decimal pl-5 space-y-1">
          <li>Go to <b>Sales → POS</b>.</li>
          <li>Tap a category, then tap a drink to add it. If it has options (size, milk,
              sugar), the customize dialog opens — confirm and the item joins the cart.</li>
          <li>Use <b>Search</b> for fast lookup. Tap a <b>Bundle</b> to add the combo.</li>
          <li>Optional: enter the customer's name, or scan their QR with <b>Scan</b> to
              attach loyalty points.</li>
          <li>Tap <b>Checkout</b>.</li>
        </ol>
      </Section>
      <Section title="3. Payment">
        <ul className="list-disc pl-5 space-y-1">
          <li>Pick a payment method. For <b>cash</b>, type the bill the customer hands you
              in the <b>Cash Bill</b> field — change is calculated.</li>
          <li>For card / GCash / transfer, the field auto-fills the remaining balance.</li>
          <li>Need to split? Add another payment row and divide the total.</li>
          <li>Tap <b>Complete order</b>. The receipt and any drink labels print
              automatically. Each label also carries a unique inspirational quote.</li>
        </ul>
      </Section>
      <Section title="4. Holding &amp; recalling orders">
        <p>Tap <b>Held</b> to park a ticket (e.g., customer stepped away) and pick it back
        up later. Tap <b>Today</b> to see every order made today and reprint a receipt or
        labels if needed.</p>
      </Section>
      <Section title="5. Self-ordering customers">
        <p>If a customer placed the order from their phone (QR self-order), it appears in
        <b> Today</b> as <i>unpaid</i>. They will show you an Order # (e.g. <code>#012</code>).
        Open the order, accept cash, and tap <b>Complete</b>. Labels print automatically.</p>
      </Section>
      <Section title="6. Mistakes">
        <p>Tap an item in the cart to remove or change quantity. If you already completed
        a wrong order, ask an admin — only admins can <b>Void</b> or <b>Refund</b>.</p>
      </Section>
      <Section title="7. End of shift">
        <p>Go to <b>Sales → End of Shift</b>. Count the cash drawer, enter the total, and
        submit. Hand the printed summary and cash to the admin/owner.</p>
      </Section>
    </>
  );
}

function CustomerGuide() {
  return (
    <>
      <Section title="What customers see">
        <p>Customers scan their personal QR (printed on their loyalty card or shared by
        the barista). It opens a clean, mobile-first ordering page:</p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>They see a greeting with their name and current loyalty points.</li>
          <li>They tap a category, then a drink. Drinks with options open a
              customize sheet (size, milk, sugar, add-ons).</li>
          <li>The cart appears at the bottom — they adjust quantities or remove items.</li>
          <li>They tap <b>Place order — Pay at counter</b>.</li>
          <li>The confirmation shows the <b>Order #</b> (large) and unique <b>Order ID</b>
              underneath. They show this to the barista to pay.</li>
        </ol>
      </Section>
      <Section title="Tips to give a great experience">
        <ul className="list-disc pl-5 space-y-1">
          <li>Print the QR card large and clear — easy to scan in low light.</li>
          <li>Greet by name when they arrive — the system already knows them.</li>
          <li>The label you hand back includes a random inspirational quote — call
              it out, it sparks delight.</li>
          <li>If the QR no longer works, re-issue from <b>Customers → Customers</b>.</li>
        </ul>
      </Section>
      <Section title="Troubleshooting">
        <ul className="list-disc pl-5 space-y-1">
          <li><b>"Invalid or expired QR"</b> — token was rotated. Re-issue the card.</li>
          <li><b>"Order didn't print"</b> — check Print Settings and the printer
              connection, then use <b>Today</b> → <b>Reprint</b>.</li>
          <li><b>Customer can't see their drink</b> — the item may be marked inactive in
              Menu &amp; Recipes.</li>
        </ul>
      </Section>
    </>
  );
}
