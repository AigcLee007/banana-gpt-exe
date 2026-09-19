# Input Bar Contrast and Collapse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the floating input bar clear visual separation in every theme and let desktop and mobile users collapse it downward into a persistent bottom capsule without losing draft state.

**Architecture:** `InputBar` keeps one session-local `isComposerCollapsed` state, leaves the expanded composer mounted for draft and scroll preservation, and swaps pointer/focus visibility between the composer and an expand capsule. A small pure layout helper owns clearance calculation so expanded and collapsed measurements are testable, while scoped CSS variables and data attributes provide theme-specific elevation and reduced-motion behavior.

**Tech Stack:** React 19, TypeScript 5.8, Tailwind CSS 3 utility classes, project-level CSS custom properties, Vitest 4, Vite 6.

---

## File Map

- Create `src/lib/inputBarLayout.ts`: pure helper for choosing the visible element and computing bottom clearance.
- Create `src/lib/inputBarLayout.test.ts`: unit tests for expanded and collapsed clearance behavior.
- Modify `src/components/InputBar.tsx`: collapse state, controls, focus transfer, overlay dismissal, mobile swipe behavior, and dynamic measurement.
- Modify `src/index.css`: composer-specific theme tokens, elevated surface styling, collapsed transitions, capsule styling, and reduced-motion override.
- Modify `src/App.tsx`: replace the fixed gallery bottom padding with padding derived from `--input-bar-clearance`.

### Task 1: Add a Testable Clearance Helper

**Files:**
- Create: `src/lib/inputBarLayout.ts`
- Test: `src/lib/inputBarLayout.test.ts`

- [ ] **Step 1: Write the failing unit tests**

Create `src/lib/inputBarLayout.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { getInputBarClearance } from './inputBarLayout'

describe('getInputBarClearance', () => {
  it('measures the expanded composer from its top edge', () => {
    expect(getInputBarClearance(900, { top: 690 })).toBe(210)
  })

  it('measures the collapsed capsule instead of the hidden composer', () => {
    expect(getInputBarClearance(900, { top: 838 })).toBe(62)
  })

  it('never returns a negative clearance', () => {
    expect(getInputBarClearance(900, { top: 940 })).toBe(0)
  })

  it('rounds fractional layout values upward', () => {
    expect(getInputBarClearance(900, { top: 837.4 })).toBe(63)
  })
})
```

- [ ] **Step 2: Run the focused test and confirm the missing-module failure**

Run: `npm test -- src/lib/inputBarLayout.test.ts`

Expected: FAIL because `./inputBarLayout` does not exist.

- [ ] **Step 3: Add the minimal pure helper**

Create `src/lib/inputBarLayout.ts`:

```ts
export type InputBarRect = Pick<DOMRectReadOnly, 'top'>

export function getInputBarClearance(viewportHeight: number, visibleRect: InputBarRect) {
  return Math.max(0, Math.ceil(viewportHeight - visibleRect.top))
}
```

- [ ] **Step 4: Run the focused test and confirm it passes**

Run: `npm test -- src/lib/inputBarLayout.test.ts`

Expected: 4 tests pass.

- [ ] **Step 5: Commit the helper and tests**

```bash
git add src/lib/inputBarLayout.ts src/lib/inputBarLayout.test.ts
git commit -m "test: cover input bar clearance"
```

### Task 2: Implement the Shared Collapse State and Accessible Controls

**Files:**
- Modify: `src/components/InputBar.tsx:1-22`
- Modify: `src/components/InputBar.tsx:500-575`
- Modify: `src/components/InputBar.tsx:1428-1460`
- Modify: `src/components/InputBar.tsx:2130-2465`

- [ ] **Step 1: Import the existing chevron icon and the clearance helper**

Replace the icon import and add the helper import:

```ts
import { ChevronDownIcon, CloseIcon } from './icons'
import { getInputBarClearance } from '../lib/inputBarLayout'
```

- [ ] **Step 2: Replace the partial mobile state with shared composer state and focus refs**

Replace `mobileCollapsed` and add refs next to the existing input-bar refs:

```ts
const [isComposerCollapsed, setIsComposerCollapsed] = useState(false)
const composerRef = useRef<HTMLDivElement>(null)
const expandButtonRef = useRef<HTMLButtonElement>(null)
const collapseButtonRef = useRef<HTMLButtonElement>(null)
const capsuleRef = useRef<HTMLButtonElement>(null)
```

Keep `cardRef` for existing composer sizing and use `composerRef` as the accessible region wrapper.

- [ ] **Step 3: Add explicit collapse and expansion callbacks**

Place these callbacks after the local state declarations:

```ts
const collapseComposer = useCallback(() => {
  setAtImageMenuDismissed(true)
  setAtImageMenuIndex(0)
  setShowMobileUploadMenu(false)
  setShowSizePicker(false)
  dismissAllTooltips()
  setIsComposerCollapsed(true)
  window.requestAnimationFrame(() => expandButtonRef.current?.focus())
}, [])

const expandComposer = useCallback(() => {
  setIsComposerCollapsed(false)
  window.requestAnimationFrame(() => collapseButtonRef.current?.focus())
}, [])
```

The callbacks intentionally do not change `prompt`, `inputImages`, `maskDraft`, `params`, or the content-editable node.

- [ ] **Step 4: Measure whichever surface is currently visible**

Replace `updateInputBarClearance` and its observer setup with:

```ts
const updateInputBarClearance = useCallback(() => {
  const visibleElement = isComposerCollapsed ? capsuleRef.current : composerRef.current
  if (!visibleElement) return
  const clearance = getInputBarClearance(window.innerHeight, visibleElement.getBoundingClientRect())
  document.documentElement.style.setProperty('--input-bar-clearance', `${clearance}px`)
}, [isComposerCollapsed])

useLayoutEffect(() => {
  const visibleElement = isComposerCollapsed ? capsuleRef.current : composerRef.current
  if (!visibleElement) return

  const frame = window.requestAnimationFrame(updateInputBarClearance)
  const observer = new ResizeObserver(updateInputBarClearance)
  observer.observe(visibleElement)
  const visualViewport = window.visualViewport
  window.addEventListener('resize', updateInputBarClearance)
  visualViewport?.addEventListener('resize', updateInputBarClearance)
  visualViewport?.addEventListener('scroll', updateInputBarClearance)

  return () => {
    window.cancelAnimationFrame(frame)
    observer.disconnect()
    window.removeEventListener('resize', updateInputBarClearance)
    visualViewport?.removeEventListener('resize', updateInputBarClearance)
    visualViewport?.removeEventListener('scroll', updateInputBarClearance)
    document.documentElement.style.removeProperty('--input-bar-clearance')
  }
}, [isComposerCollapsed, updateInputBarClearance])
```

- [ ] **Step 5: Make the mobile handle control the whole composer**

Change the swipe thresholds and click handler to call the shared callbacks:

```ts
if (dy > 30) collapseComposer()
if (dy < -30) expandComposer()
```

The mobile handle click becomes `onClick={collapseComposer}` while the expanded card is visible. Remove both `.collapse-section` wrappers and the collapsed reference-image summary, because reference images and parameters now leave together with the whole composer.

- [ ] **Step 6: Wrap the composer in an accessible animated region**

Give the fixed container a state attribute and wrap the existing card without unmounting it:

```tsx
<div
  data-input-bar
  data-composer-state={isComposerCollapsed ? 'collapsed' : 'expanded'}
  className="fixed bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 z-30 w-full max-w-4xl px-3 sm:px-4"
>
  <div
    id="image-generation-composer"
    ref={composerRef}
    aria-hidden={isComposerCollapsed}
    inert={isComposerCollapsed ? true : undefined}
    className="input-bar-composer"
  >
    <div ref={cardRef} className="input-bar-card rounded-2xl p-3 sm:rounded-3xl sm:p-4">
      {/* existing composer content */}
    </div>
  </div>
</div>
```

Do not conditionally render the composer. The `inert` attribute prevents focus and pointer interaction while collapsed.

- [ ] **Step 7: Add the desktop collapse button**

Place this as the first child of `input-bar-card`; keep the existing mobile handle below it:

```tsx
<button
  ref={collapseButtonRef}
  type="button"
  onClick={collapseComposer}
  className="input-bar-collapse-button hidden sm:flex"
  aria-label="收起输入框"
  aria-controls="image-generation-composer"
  aria-expanded={!isComposerCollapsed}
  title="收起输入框"
>
  <ChevronDownIcon className="h-4 w-4" />
</button>
```

- [ ] **Step 8: Add the persistent expand capsule**

Place the capsule as a sibling immediately after `input-bar-composer`:

```tsx
<button
  ref={(node) => {
    capsuleRef.current = node
    expandButtonRef.current = node
  }}
  type="button"
  onClick={expandComposer}
  className="input-bar-expand-capsule"
  aria-label="展开输入框"
  aria-controls="image-generation-composer"
  aria-expanded={!isComposerCollapsed}
  tabIndex={isComposerCollapsed ? 0 : -1}
>
  <ChevronDownIcon className="h-4 w-4 rotate-180" />
  <span>展开输入框</span>
</button>
```

- [ ] **Step 9: Run type checking through the production build**

Run: `npm run build`

Expected: TypeScript and Vite complete successfully. If React's type definitions reject boolean `inert`, use `inert={isComposerCollapsed ? '' : undefined}` and confirm the generated attribute remains standards-compliant.

- [ ] **Step 10: Commit the interaction changes**

```bash
git add src/components/InputBar.tsx src/lib/inputBarLayout.ts
git commit -m "feat: add collapsible input bar"
```

### Task 3: Add Theme Separation, Motion, and Dynamic Page Padding

**Files:**
- Modify: `src/index.css:46-94`
- Modify: `src/index.css:96-103`
- Modify: `src/index.css:500-535`
- Modify: `src/App.tsx:188-199`

- [ ] **Step 1: Add composer-specific theme tokens**

Add the following variables to each theme block:

```css
:root[data-theme="light"] {
  --composer-surface: rgba(255, 255, 255, 0.97);
  --composer-input: #f8fafc;
  --composer-border: rgba(100, 116, 139, 0.48);
  --composer-shadow: 0 2px 8px rgb(15 23 42 / 0.10), 0 18px 48px rgb(15 23 42 / 0.16);
  --composer-fade: rgb(248 250 252 / 0.88);
}

:root[data-theme="dark"] {
  --composer-surface: rgba(27, 31, 42, 0.98);
  --composer-input: rgba(15, 17, 23, 0.72);
  --composer-border: rgba(119, 134, 165, 0.64);
  --composer-shadow: 0 2px 10px rgb(0 0 0 / 0.38), 0 20px 52px rgb(0 0 0 / 0.52);
  --composer-fade: rgb(15 17 23 / 0.84);
}

:root[data-theme="sepia"],
:root[data-theme="cream"] {
  --composer-surface: rgba(255, 251, 244, 0.98);
  --composer-input: #f8eedf;
  --composer-border: rgba(177, 147, 111, 0.62);
  --composer-shadow: 0 2px 9px rgb(101 79 49 / 0.16), 0 18px 46px rgb(101 79 49 / 0.24);
  --composer-fade: rgb(246 239 227 / 0.88);
}
```

- [ ] **Step 2: Stop the generic surface override from styling the composer**

Remove `:root[data-theme] [data-input-bar] > div > div` from the generic elevated-surface selector. The dedicated `.input-bar-card` rule added in the next step becomes the single owner of this surface.

- [ ] **Step 3: Add scoped composer, capsule, and transition styles**

Add after the theme blocks:

```css
[data-input-bar]::before {
  content: '';
  position: absolute;
  inset: -28px 0 -16px;
  z-index: -1;
  pointer-events: none;
  background: linear-gradient(to bottom, transparent, var(--composer-fade) 58%, var(--composer-fade));
  opacity: 0.72;
}

.input-bar-composer {
  transform: translateY(0);
  opacity: 1;
  transition: transform 240ms cubic-bezier(0.16, 1, 0.3, 1), opacity 180ms ease-out;
}

.input-bar-card,
.input-bar-expand-capsule {
  border: 1px solid var(--composer-border);
  background: var(--composer-surface);
  box-shadow: var(--composer-shadow);
  backdrop-filter: blur(24px);
}

.input-bar-card {
  position: relative;
}

.input-bar-card [contenteditable="true"] {
  border-color: var(--app-border-strong);
  background: var(--composer-input);
}

.input-bar-card [contenteditable="true"]:focus {
  border-color: rgb(59 130 246 / 0.72);
  box-shadow: 0 0 0 3px rgb(59 130 246 / 0.14);
}

.input-bar-collapse-button {
  position: absolute;
  top: -13px;
  right: 18px;
  z-index: 2;
  height: 28px;
  width: 36px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--composer-border);
  border-radius: 999px;
  background: var(--composer-surface);
  color: var(--app-text-subtle);
  box-shadow: 0 4px 12px rgb(0 0 0 / 0.12);
}

.input-bar-collapse-button:focus-visible,
.input-bar-expand-capsule:focus-visible {
  outline: 2px solid rgb(59 130 246 / 0.78);
  outline-offset: 3px;
}

.input-bar-expand-capsule {
  position: absolute;
  left: 50%;
  bottom: 0;
  display: flex;
  min-height: 44px;
  min-width: 148px;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  border-radius: 999px;
  color: var(--app-text-muted);
  font-size: 0.875rem;
  font-weight: 600;
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, 12px);
  transition: transform 240ms cubic-bezier(0.16, 1, 0.3, 1), opacity 180ms ease-out;
}

[data-composer-state="collapsed"] .input-bar-composer {
  opacity: 0;
  pointer-events: none;
  transform: translateY(calc(100% + 2rem));
}

[data-composer-state="collapsed"] {
  pointer-events: none;
}

[data-composer-state="collapsed"] .input-bar-expand-capsule {
  opacity: 1;
  pointer-events: auto;
  transform: translate(-50%, 0);
}

[data-composer-state="collapsed"]::before {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .input-bar-composer,
  .input-bar-expand-capsule {
    transition-duration: 1ms;
  }
}
```

- [ ] **Step 4: Make gallery bottom padding follow the visible input surface**

In `src/App.tsx`, change the gallery main element from `pb-48` to:

```tsx
<main
  data-home-main
  data-drag-select-surface
  className="pb-[calc(var(--input-bar-clearance,12rem)+1.5rem)] transition-[padding-bottom] duration-300 motion-reduce:transition-none"
>
```

Agent mode already uses `--input-bar-clearance`; verify its jump-to-bottom button continues to sit above the visible composer or capsule.

- [ ] **Step 5: Remove obsolete partial-collapse CSS**

Delete `.collapse-section`, `.collapse-section.collapsed`, and their `.collapse-inner` rules from `src/index.css` after confirming no other component uses those selectors:

Run: `rg -n "collapse-section|collapse-inner" src`

Expected before deletion: only the obsolete CSS rules; expected after deletion: no matches.

- [ ] **Step 6: Run unit tests and production build**

Run: `npm test`

Expected: all Vitest suites pass.

Run: `npm run build`

Expected: TypeScript and Vite complete successfully.

- [ ] **Step 7: Commit visual and layout changes**

```bash
git add src/index.css src/App.tsx src/components/InputBar.tsx
git commit -m "style: strengthen input bar hierarchy"
```

### Task 4: Browser Verification Across Themes and Viewports

**Files:**
- Verify: `src/components/InputBar.tsx`
- Verify: `src/index.css`
- Verify: `src/App.tsx`

- [ ] **Step 1: Start the development server**

Run: `npm run dev -- --host 127.0.0.1`

Expected: Vite reports a local URL and the page loads without console errors.

- [ ] **Step 2: Verify desktop interaction at 1920 × 1080**

For light, dark, and sepia themes, verify:

- the input surface has a clearly visible border and tonal separation from task cards;
- the collapse control is visible, labeled `收起输入框`, and does not overlap the prompt clear button;
- collapse dismisses the `@` reference menu, mobile upload menu when applicable, and size picker;
- the capsule reads `展开输入框` and restores the composer;
- a long prompt, reference images, model selection, aspect ratio, image size, and count survive a round trip;
- keyboard focus moves to the capsule on collapse and back to the collapse button on expansion;
- the final gallery row and agent jump-to-bottom button are not obscured.

- [ ] **Step 3: Verify mobile interaction at 390 × 844**

For all themes, verify tap and swipe-down on the handle collapse the whole composer, the capsule stays above the safe area, swipe/tap does not submit or clear content, and expanding restores the full layout without horizontal overflow.

- [ ] **Step 4: Verify reduced motion**

Emulate `prefers-reduced-motion: reduce`, collapse and expand twice, and confirm state changes are effectively immediate while focus behavior remains correct.

- [ ] **Step 5: Run the final verification commands**

Run: `npm test && npm run build`

Expected: all tests pass and the production build succeeds.

- [ ] **Step 6: Review the final diff and commit any verification fixes**

Run: `git diff --check`

Expected: no whitespace errors.

If browser verification required code changes, commit only the affected feature files:

```bash
git add src/components/InputBar.tsx src/index.css src/App.tsx src/lib/inputBarLayout.ts src/lib/inputBarLayout.test.ts
git commit -m "fix: polish collapsed input bar behavior"
```
