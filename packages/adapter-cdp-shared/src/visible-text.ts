/**
 * Page-context source for the visible-text walk. Lives in its own module
 * because it is a string (Runtime.evaluate takes source text) and clutters
 * the driver class file.
 */

/**
 * Walks the DOM and returns text blocks (headings / paragraphs / list
 * items / labels / table cells) that intersect the padded viewport. Runs
 * inside the page context.
 */
export const VISIBLE_TEXT_WALKER_SOURCE = `function (pad) {
  const TAG_TO_KIND = {
    H1: 'heading', H2: 'heading', H3: 'heading',
    H4: 'heading', H5: 'heading', H6: 'heading',
    P: 'paragraph',
    LI: 'list-item',
    LABEL: 'label',
    TD: 'table-cell', TH: 'table-cell',
    DT: 'label', DD: 'paragraph',
  };
  const MAX_TEXT_LEN = 800;
  const blocks = [];
  const seen = new WeakSet();
  const vh = window.innerHeight;
  const top = window.scrollY - pad * vh;
  const bottom = window.scrollY + (pad + 1) * vh;

  const walker = document.createTreeWalker(
    document.body, NodeFilter.SHOW_ELEMENT,
  );

  while (walker.nextNode()) {
    const el = walker.currentNode;
    const kind = TAG_TO_KIND[el.tagName];
    if (!kind) continue;
    if (seen.has(el)) continue;

    const rect = el.getBoundingClientRect();
    if (rect.bottom < top - window.scrollY) continue;
    if (rect.top > bottom - window.scrollY) continue;
    if (rect.width === 0 && rect.height === 0) continue;

    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') {
      continue;
    }

    const text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (!text) continue;
    if (text.length > MAX_TEXT_LEN) continue;

    seen.add(el);
    const block = { kind: kind, text: text };
    if (kind === 'heading') {
      block.level = parseInt(el.tagName.slice(1), 10);
    }
    blocks.push(block);
  }
  return blocks;
}`;
