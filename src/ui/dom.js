export function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

// only touches the DOM when the text changed, the HUD calls this every frame
export function setText(e, t) {
  if (e._t !== t) {
    e._t = t;
    e.textContent = t;
  }
}
