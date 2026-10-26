'use client';

import {
  BarChart3,
  Building2,
  Factory,
  FileText,
  Globe,
  Landmark,
  Lock,
  Package,
  Sailboat,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Store,
  Truck,
  Users,
  Database,
  BrickWall,
  Glasses,
  type LucideIcon,
} from 'lucide-react';

/**
 * Icons for the marketing site.
 *
 * The content files used to carry an emoji per module/industry. An emoji is a
 * font glyph: it renders differently on every platform, cannot inherit the
 * brand colour, and reads as decoration rather than product. The data now keeps
 * the same keys, and this component maps them to one icon set — so the page and
 * the card always agree, in both locales.
 */
const ICONS: Record<string, LucideIcon> = {
  '🧵': Shirt,
  '👓': Glasses,
  '⛵': Sailboat,
  '🏗️': Building2,
  '🛍️': ShoppingBag,
  '📊': BarChart3,
  '🏦': Landmark,
  '🏭': Factory,
  '🛒': ShoppingCart,
  '🧾': FileText,
  '👥': Users,
  '🔐': Lock,
  '🧱': BrickWall,
  '💾': Database,
  '📦': Package,
  '📱': Smartphone,
  '🚚': Truck,
  '🥖': Store,
  '🌐': Globe,
  '✨': Sparkles,
};

export function SiteIcon({
  glyph,
  size = 22,
  className,
}: {
  glyph?: string | null;
  size?: number;
  className?: string;
}) {
  const Icon = (glyph && ICONS[glyph]) || Package;
  return <Icon size={size} strokeWidth={1.7} className={className} aria-hidden />;
}
