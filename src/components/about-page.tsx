import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { useEffect, useRef } from "react";
import {
  ArrowDown,
  ArrowDownRight,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  Barcode,
  Boxes,
  ClipboardCheck,
  History,
  MapPin,
  Package,
  PackageCheck,
  ScanLine,
  Search,
  SlidersHorizontal,
  Truck,
  Warehouse,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import warehouseImage from "@/assets/about-warehouse.svg";
import scanningImage from "@/assets/about-scanning.svg";
import "./about-page.css";

const flow = [
  {
    number: "01",
    title: "Receive",
    sub: "It arrives. You know what came in.",
    icon: PackageCheck,
    code: "WH/IN/00002",
    qty: "+50",
  },
  {
    number: "02",
    title: "Move",
    sub: "Every location has a story.",
    icon: ArrowLeftRight,
    code: "A-01 → B-04",
    qty: "30",
  },
  {
    number: "03",
    title: "Deliver",
    sub: "Out the door, never off the radar.",
    icon: Truck,
    code: "WH/OUT/00018",
    qty: "−20",
  },
  {
    number: "04",
    title: "Adjust",
    sub: "Make the count match reality.",
    icon: ClipboardCheck,
    code: "COUNT / 024",
    qty: "−3",
  },
  {
    number: "05",
    title: "Ledger",
    sub: "The whole picture, in one place.",
    icon: History,
    code: "ALL MOVEMENTS",
    qty: "97",
  },
];

const features = [
  { title: "Product management", icon: Package, note: "A home for every SKU", cls: "f-one" },
  { title: "Multi-warehouse", icon: Warehouse, note: "Every place in view", cls: "f-two" },
  { title: "Receipts", icon: PackageCheck, note: "Know what arrived", cls: "f-three" },
  { title: "Delivery orders", icon: Truck, note: "Keep orders moving", cls: "f-four" },
  { title: "Internal transfers", icon: ArrowLeftRight, note: "Track every handoff", cls: "f-five" },
  { title: "Stock adjustments", icon: ClipboardCheck, note: "Count with confidence", cls: "f-six" },
  { title: "Stock ledger", icon: History, note: "Nothing gets lost", cls: "f-seven" },
  {
    title: "Low-stock alerts",
    icon: SlidersHorizontal,
    note: "Stay one step ahead",
    cls: "f-eight",
  },
  { title: "SKU search", icon: Search, note: "Find it faster", cls: "f-nine" },
];

function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in-view");
            observer.unobserve(entry.target);
          }
        }),
      { threshold: 0.12, rootMargin: "0px 0px -35px 0px" },
    );
    root.querySelectorAll(".about-reveal").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
  return ref;
}

function MiniScreen({
  kind,
  className = "",
}: {
  kind: "dashboard" | "products" | "receipt" | "delivery" | "transfer" | "ledger";
  className?: string;
}) {
  const label = {
    dashboard: "Overview",
    products: "Products",
    receipt: "Incoming stock",
    delivery: "Delivery orders",
    transfer: "Internal transfers",
    ledger: "Move history",
  }[kind];
  return (
    <div className={`about-screen ${className}`} aria-label={`${label} interface illustration`}>
      <div className="screen-top">
        <span className="screen-logo">
          <Boxes size={13} /> StockSense
        </span>
        <span className="screen-dots">
          <i />
          <i />
          <i />
        </span>
      </div>
      <div className="screen-body">
        <div className="screen-sidebar">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="screen-content">
          <div className="screen-kicker">WORKSPACE / {label.toUpperCase()}</div>
          <div className="screen-title">
            {label}
            <span>•••</span>
          </div>
          {kind === "dashboard" ? (
            <>
              <div className="screen-stats">
                <div>
                  <small>TOTAL PRODUCTS</small>
                  <b>248</b>
                  <em>↗ 12.8%</em>
                </div>
                <div>
                  <small>STOCK ON HAND</small>
                  <b>18,420</b>
                  <em>↗ 6.2%</em>
                </div>
                <div>
                  <small>ACTIVE LOCATIONS</small>
                  <b>08</b>
                  <em>LIVE</em>
                </div>
              </div>
              <div className="screen-chart">
                <div className="chart-line" />
                <span>JAN</span>
                <span>FEB</span>
                <span>MAR</span>
                <span>APR</span>
                <span>MAY</span>
                <span>JUN</span>
              </div>
            </>
          ) : (
            <div className="screen-table">
              <div className="screen-table-head">
                <span>REFERENCE / PRODUCT</span>
                <span>LOCATION</span>
                <span>STATUS</span>
              </div>
              {(kind === "products"
                ? [
                    ["Steel Rods", "WH / A-01", "In stock"],
                    ["Aluminum Sheets", "WH / B-02", "In stock"],
                    ["Copper Wire", "WH / A-04", "Low stock"],
                  ]
                : kind === "receipt"
                  ? [
                      ["WH/IN/00002", "Main warehouse", "Ready"],
                      ["WH/IN/00003", "North storage", "Waiting"],
                      ["WH/IN/00004", "Main warehouse", "Done"],
                    ]
                  : kind === "delivery"
                    ? [
                        ["WH/OUT/00018", "Main warehouse", "Ready"],
                        ["WH/OUT/00019", "North storage", "Picked"],
                        ["WH/OUT/00020", "Main warehouse", "Done"],
                      ]
                    : kind === "transfer"
                      ? [
                          ["WH/TR/00007", "A-01 → B-04", "Done"],
                          ["WH/TR/00008", "B-02 → A-03", "Ready"],
                          ["WH/TR/00009", "A-04 → B-01", "Waiting"],
                        ]
                      : [
                          ["+50 · Receipt", "WH / A-01", "Done"],
                          ["−30 · Transfer", "WH / B-04", "Done"],
                          ["−20 · Delivery", "WH / B-04", "Done"],
                        ]
              ).map((row, i) => (
                <div className="screen-row" key={i}>
                  <span>
                    <i className="screen-row-icon" />
                    {row[0]}
                  </span>
                  <span>{row[1]}</span>
                  <span className="screen-badge">{row[2]}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function AboutPage() {
  const root = useReveal();
  const { user } = useAuth();
  // Signed-out visitors get the sign-in screen; signed-in ones go where the
  // button says. Without this they would land on a guarded route and bounce.
  const workspaceTo = user ? "/" : "/auth";
  const productsTo = user ? "/products" : "/auth";
  return (
    <div className="about-page" ref={root}>
      <header className="about-nav">
        <Link to="/about" className="about-brand">
          <span className="brand-mark">
            <Boxes size={20} />
          </span>{" "}
          StockSense<span className="brand-period">.</span>
        </Link>
        <nav aria-label="About page navigation">
          <a href="#story">Our story</a>
          <a href="#approach">How it works</a>
          <a href="#platform">Platform</a>
        </nav>
        <Button asChild className="about-nav-cta">
          <Link to={workspaceTo}>
            Open workspace <ArrowUpRight size={16} />
          </Link>
        </Button>
      </header>

      <main>
        <section className="about-hero" aria-labelledby="about-hero-title">
          <div className="hero-halo" aria-hidden="true" />
          <div className="hero-copy about-reveal">
            <div className="about-eyebrow">
              <span className="eyebrow-line" /> A NEW PERSPECTIVE ON INVENTORY{" "}
              <span className="eyebrow-line" />
            </div>
            <h1 id="about-hero-title">
              Inventory that moves
              <br />
              <em>with your business.</em>
            </h1>
            <p>
              Products, places, and every movement between them — connected in one clear view. Meet
              StockSense.
            </p>
          </div>
          <div
            className="hero-art"
            aria-label="Illustration of connected inventory moving between warehouse locations"
            role="img"
          >
            <div className="art-horizon" />
            <div className="art-orbit orbit-one" />
            <div className="art-orbit orbit-two" />
            <div className="art-shelf shelf-left">
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="art-shelf shelf-right">
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="art-platform">
              <span className="platform-grid" />
            </div>
            <div className="art-box box-large">
              <div className="box-top" />
              <div className="box-front">
                <span className="box-symbol">
                  <Boxes size={37} />
                </span>
                <i className="box-barcode" />
              </div>
              <div className="box-side" />
            </div>
            <div className="art-box box-small">
              <div className="box-top" />
              <div className="box-front">
                <span className="box-symbol">
                  <Package size={23} />
                </span>
                <i className="box-barcode" />
              </div>
              <div className="box-side" />
            </div>
            <div className="art-box box-high">
              <div className="box-top" />
              <div className="box-front">
                <span className="box-symbol">
                  <Barcode size={29} />
                </span>
              </div>
              <div className="box-side" />
            </div>
            <div className="art-tag tag-one">
              <span className="tag-dot" /> RECEIVED <b>+50 units</b>
            </div>
            <div className="art-tag tag-two">
              <MapPin size={14} /> WH / A-01 <b>LOCATED</b>
            </div>
            <div className="art-tag tag-three">
              <ArrowLeftRight size={14} /> IN TRANSIT <b>A-01 → B-04</b>
            </div>
            <span className="art-node node-one" />
            <span className="art-node node-two" />
            <span className="art-node node-three" />
            <span className="art-arc arc-one" />
            <span className="art-arc arc-two" />
            <div className="art-coordinate">FIG 01 — A SYSTEM IN MOTION</div>
          </div>
          <a className="hero-scroll" href="#statement">
            SCROLL TO EXPLORE <ArrowDown size={14} />
          </a>
        </section>

        <section className="statement-wrap" id="statement">
          <div className="statement-banner about-reveal">
            <div className="statement-lines" aria-hidden="true" />
            <span className="about-eyebrow">THE BIG PICTURE / 001</span>
            <h2>
              Know what you have.
              <br />
              Know where it is.
              <br />
              <em>Know how it moves.</em>
            </h2>
            <div className="statement-bottom">
              <p>
                One connected picture of inventory — from the first receipt to the last movement.
              </p>
              <span className="statement-glyph">
                <ArrowDownRight size={26} />
              </span>
            </div>
          </div>
        </section>

        <section className="story-section about-container" id="story">
          <div className="story-copy about-reveal">
            <span className="about-eyebrow">01 / THE PROBLEM</span>
            <h2>
              Inventory shouldn't
              <br />
              be a <em>guessing game.</em>
            </h2>
            <p>
              Spreadsheets in one place. Paper counts in another. A delivery noted somewhere else.
              When the pieces don't connect, the picture is always incomplete.
            </p>
            <p>
              StockSense brings the fragments together, so teams can spend less time looking for
              answers and more time acting on them.
            </p>
            <span className="story-index">FROM FRAGMENTS → TO FOCUS</span>
          </div>
          <div
            className="story-visual about-reveal"
            aria-label="Scattered records becoming an organized StockSense view"
          >
            <div className="fragment fragment-paper">
              <span>STOCK COUNT / 04</span>
              <div />
              <div />
              <div />
              <small>???</small>
            </div>
            <div className="fragment fragment-sheet">
              <span>items_final_v3.xlsx</span>
              <div>SKU ░░░░░░ QTY</div>
              <div>001 ░░░░░░ 124</div>
              <div>002 ░░░░░░ ?</div>
            </div>
            <div className="fragment fragment-label">
              <Barcode size={39} />
              <small>WH / B-04</small>
            </div>
            <span className="fragment-direction">
              <ArrowRight size={26} />
            </span>
            <MiniScreen kind="products" className="story-screen" />
          </div>
        </section>

        <section className="approach-section" id="approach">
          <div className="about-container">
            <div className="approach-intro about-reveal">
              <span className="about-eyebrow">02 / HOW IT WORKS</span>
              <div className="approach-title">
                <h2>
                  Every movement
                  <br />
                  <em>leaves a trail.</em>
                </h2>
                <span className="approach-seal">
                  <ScanLine size={34} />
                </span>
              </div>
              <p>
                Inventory is more than a number on a screen. It's a sequence of arrivals, handoffs,
                departures, and decisions. StockSense keeps the context intact.
              </p>
            </div>
            <div className="flow-layout" aria-label="Inventory operation flow">
              {flow.map((item, i) => {
                const Icon = item.icon;
                return (
                  <div className={`flow-row flow-${i + 1} about-reveal`} key={item.title}>
                    <span className="flow-number">{item.number} / 05</span>
                    <span className="flow-rail">
                      <span />
                    </span>
                    <div className="flow-text">
                      <h3>
                        {item.title}
                        <span>.</span>
                      </h3>
                      <p>{item.sub}</p>
                    </div>
                    <div className="flow-object">
                      <span className="flow-icon">
                        <Icon size={28} strokeWidth={1.5} />
                      </span>
                      <span className="flow-code">
                        {item.code}
                        <strong>{item.qty}</strong>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="platform-section" id="platform">
          <div className="about-container platform-heading about-reveal">
            <span className="about-eyebrow">03 / THE PLATFORM</span>
            <h2>
              Clarity at every
              <br />
              <em>point of operation.</em>
            </h2>
            <p>One connected workspace. Six perspectives on what matters.</p>
          </div>
          <div className="platform-collage" aria-label="Illustrations of StockSense screens">
            <MiniScreen kind="dashboard" className="collage-dashboard" />
            <MiniScreen kind="products" className="collage-products" />
            <MiniScreen kind="receipt" className="collage-receipt" />
            <MiniScreen kind="delivery" className="collage-delivery" />
            <MiniScreen kind="transfer" className="collage-transfer" />
            <MiniScreen kind="ledger" className="collage-ledger" />
          </div>
          <div className="platform-captions about-container">
            <span>THE WORKSPACE / 01—06</span>
            <span>DASHBOARD · PRODUCTS · RECEIPTS · DELIVERIES · TRANSFERS · LEDGER</span>
          </div>
        </section>

        <section className="mission-section">
          <div className="mission-card about-reveal">
            <span className="about-eyebrow">04 / OUR MISSION</span>
            <h2>
              To make inventory
              <br />
              <em>clearer, more organized,</em>
              <br />
              and easier to control.
            </h2>
            <div className="mission-bottom">
              <span className="mission-mark">
                <Boxes size={33} />
              </span>
              <p>
                StockSense brings the essential parts of inventory operations into one structured
                system, giving teams a clearer view of their products, locations, and stock
                movements.
              </p>
            </div>
            <span className="mission-corner">SS / 004</span>
          </div>
        </section>

        <section className="photo-section about-container">
          <div className="photo-heading about-reveal">
            <span className="about-eyebrow">BUILT FOR THE REAL WORLD</span>
            <h2>
              Where the work
              <br />
              <em>actually happens.</em>
            </h2>
          </div>
          <div className="photo-composition">
            <div className="photo-main about-reveal">
              <img
                src={warehouseImage}
                width={1536}
                height={1024}
                loading="lazy"
                alt="Warehouse worker scanning organized inventory on shelves"
              />
              <span>01 / THE WAREHOUSE</span>
            </div>
            <div className="photo-accent" aria-hidden="true" />
            <div className="photo-inset about-reveal">
              <img
                src={scanningImage}
                width={1280}
                height={1024}
                loading="lazy"
                alt="Labeled product boxes and barcode scanner at a warehouse worktable"
              />
              <span>02 / THE HANDOFF</span>
            </div>
            <div className="photo-caption">
              From shelf to shipment,
              <br />
              nothing happens in isolation. <ArrowUpRight size={19} />
            </div>
          </div>
        </section>

        <section className="visibility-section about-container">
          <div className="visibility-copy about-reveal">
            <span className="about-eyebrow">05 / FULL VISIBILITY</span>
            <h2>
              From a stock number
              <br />
              to the <em>story behind it.</em>
            </h2>
            <p>See not only what's on hand, but the operations that brought you there.</p>
          </div>
          <div className="visibility-ledger about-reveal">
            <div className="ledger-head">
              <span>STEEL RODS / RAW-STL-001</span>
              <span>
                LIVE MOVEMENT TRAIL <span className="live-dot" />
              </span>
            </div>
            <div className="ledger-origin">
              <span>OPENING STOCK</span>
              <strong>
                100 <small>units</small>
              </strong>
            </div>
            {[
              ["01", "Received", "+50", "WH/IN/00002"],
              ["02", "Transferred", "−30", "WH/TR/00007"],
              ["03", "Delivered", "−20", "WH/OUT/00018"],
              ["04", "Adjusted", "−3", "WH/ADJ/00004"],
            ].map((row) => (
              <div className="ledger-event" key={row[0]}>
                <span>{row[0]}</span>
                <span>
                  {row[1]}
                  <small>{row[3]}</small>
                </span>
                <strong>{row[2]}</strong>
              </div>
            ))}
            <div className="ledger-result">
              <span>
                ON HAND NOW <small>THE COMPLETE PICTURE</small>
              </span>
              <strong>
                97 <small>units</small>
              </strong>
            </div>
          </div>
        </section>

        <section className="features-section about-container">
          <div className="features-heading about-reveal">
            <span className="about-eyebrow">06 / ONE CONNECTED SYSTEM</span>
            <h2>
              All the moving parts.
              <br />
              <em>One place.</em>
            </h2>
          </div>
          <div className="feature-field">
            {features.map(({ title, icon: Icon, note, cls }, i) => (
              <div className={`feature-tile ${cls} about-reveal`} key={title}>
                <span className="feature-top">
                  <Icon size={21} strokeWidth={1.6} />
                  <small>{String(i + 1).padStart(2, "0")}</small>
                </span>
                <strong>{title}</strong>
                <span>{note}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="about-final">
          <div className="final-network" aria-hidden="true">
            <svg viewBox="0 0 1200 460" preserveAspectRatio="xMidYMid meet">
              <path d="M95 305 C260 305 245 110 445 150 S695 355 865 210 S1050 115 1130 145" />
              <path d="M85 150 C270 180 285 355 510 320 S805 85 1110 315" />
              <circle cx="95" cy="305" r="7" />
              <circle cx="445" cy="150" r="7" />
              <circle cx="865" cy="210" r="7" />
              <circle cx="1130" cy="145" r="7" />
              <circle cx="510" cy="320" r="7" />
              <circle cx="1110" cy="315" r="7" />
            </svg>
            <span className="network-label label-a">WH / NORTH</span>
            <span className="network-label label-b">WH / CENTRAL</span>
            <span className="network-label label-c">WH / SOUTH</span>
          </div>
          <div className="final-content about-reveal">
            <span className="about-eyebrow">THE NEXT MOVE IS YOURS</span>
            <h2>
              Bring your inventory
              <br />
              <em>into focus.</em>
            </h2>
            <p>
              Manage products, track stock movements, and keep every inventory operation connected
              in one place.
            </p>
            <div className="final-actions">
              <Button asChild className="final-primary">
                <Link to={productsTo}>
                  Explore StockSense <ArrowUpRight size={17} />
                </Link>
              </Button>
              <Button asChild variant="outline" className="final-secondary">
                <Link to={workspaceTo}>
                  View dashboard <ArrowRight size={17} />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </main>
      <footer className="about-footer">
        <Link to="/about" className="about-brand">
          <span className="brand-mark">
            <Boxes size={17} />
          </span>{" "}
          StockSense<span className="brand-period">.</span>
        </Link>
        <span>MAKE EVERY MOVEMENT COUNT.</span>
        <span>© 2026 STOCKSENSE</span>
      </footer>
    </div>
  );
}
