'use client';

import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../lib/cn';

/**
 * Card — the surface every panel, table and dialog body sits on.
 *
 * It is a **Panel**: the same surface, the same head band, the same body
 * padding as `Panel` in `layout.tsx`. It used to be a padded box with a title
 * row inside the padding, which is why the bakery surface read differently
 * from the staff one: same colours, different structure. Now `Card` +
 * `CardHeader` + `CardBody` compose exactly like `Panel` + head + body, so a
 * screen built from either pair has the same rhythm.
 *
 * `variant="raised"` lifts the surface for a floating layer; `padded` is kept
 * for cards that hold raw children with no `CardBody` — those still need the
 * inner padding the panel does not add by itself.
 */
export type CardProps = HTMLAttributes<HTMLDivElement> & {
  hover?: boolean;
  padded?: boolean;
  variant?: 'plain' | 'raised';
};

export function Card({
  hover = false,
  padded = true,
  variant = 'plain',
  className = '',
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={cn(
        'ui-panel',
        'ui-card',
        padded ? 'ui-card-padded' : 'ui-card-bare',
        variant === 'raised' && 'shadow-3',
        hover &&
          'transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-line-strong hover:shadow-4',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * The head band. Same markup as `ui-panel-head`: title, optional hint under it,
 * actions on the far edge. No decoration dot — the kit marks a panel by its
 * rule and spacing, not by an ornament that has to be repeated per app.
 */
export function CardHeader({
  title,
  subtitle,
  action,
  className = '',
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('ui-panel-head', className)}>
      <div className="ui-panel-copy">
        <h2 className="ui-panel-title">{title}</h2>
        {subtitle ? <p className="ui-panel-hint">{subtitle}</p> : null}
      </div>
      {action ? <div className="ui-panel-actions">{action}</div> : null}
    </div>
  );
}

/**
 * جسمُ البطاقة. و`flush` للجداول والقوائم الطويلة: يُلغى الحشو فتلتصق
 * الشبكة بالحدود — نفسُ قاعدة `Panel` فتصير البطاقتان شيئًا واحدًا.
 */
export function CardBody({
  children,
  className = '',
  flush = false,
}: {
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <div className={cn('ui-panel-body', flush && 'ui-panel-body-flush', className)}>{children}</div>
  );
}

export function CardFooter({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn('ui-panel-foot', className)}>{children}</div>;
}
