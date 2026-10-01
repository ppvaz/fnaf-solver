// The trainer's element lookups. Every element a module looks up is in index.html or in markup the
// module built itself, so a lookup that finds nothing is a bug in that markup, not a state to handle.

/** The element `selector` names under `root`, as the markup that holds it declares it. */
export function find<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  return root.querySelector(selector) as T;
}

/** The element index.html gives this id, as the page declares it. */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
