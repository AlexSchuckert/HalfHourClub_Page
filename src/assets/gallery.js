/* Click any image in a contribution to see it full-screen; arrow keys move
 * between all the images on the club page.
 *
 * A lightbox rather than the mooring wiki's inline carousel: a carousel has to
 * pull images out of the flow and group them, which would scramble a poem that
 * has drawings interleaved between its verses. This leaves the page alone.
 *
 * Uses <dialog>, so Escape and the backdrop come for free. Images inside a
 * collapsed <details> are picked up too — the list is read at click time, and
 * an unopened contribution's images simply aren't reachable to click.
 */
(function () {
  const images = () => Array.from(document.querySelectorAll('.contribution__body img.media-image'));
  if (!images().length) return;

  const dialog = document.createElement('dialog');
  dialog.className = 'lightbox';
  dialog.innerHTML = `
    <button type="button" class="lightbox__close" aria-label="Close">✕</button>
    <button type="button" class="lightbox__arrow lightbox__prev" aria-label="Previous image">‹</button>
    <img alt="" />
    <button type="button" class="lightbox__arrow lightbox__next" aria-label="Next image">›</button>
    <p class="lightbox__caption"></p>
  `;
  document.body.append(dialog);

  const view = dialog.querySelector('img');
  const caption = dialog.querySelector('.lightbox__caption');
  const prev = dialog.querySelector('.lightbox__prev');
  const next = dialog.querySelector('.lightbox__next');

  let gallery = [];
  let index = 0;

  function show(position) {
    if (!gallery.length) return;
    index = (position + gallery.length) % gallery.length;
    const source = gallery[index];
    view.src = source.currentSrc || source.src;
    view.alt = source.alt || '';
    caption.textContent =
      (source.alt ? `${source.alt} · ` : '') + `${index + 1} / ${gallery.length}`;
    // With a single image there's nothing to step through.
    const solo = gallery.length < 2;
    prev.hidden = solo;
    next.hidden = solo;
    caption.hidden = solo && !source.alt;
  }

  document.addEventListener('click', (event) => {
    const image = event.target.closest('.contribution__body img.media-image');
    if (!image) return;
    gallery = images();
    show(gallery.indexOf(image));
    dialog.showModal();
  });

  prev.addEventListener('click', () => show(index - 1));
  next.addEventListener('click', () => show(index + 1));
  dialog.querySelector('.lightbox__close').addEventListener('click', () => dialog.close());

  // Clicking the backdrop (i.e. the dialog itself, not its contents) closes it.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
      show(index - 1);
      event.preventDefault();
    }
    if (event.key === 'ArrowRight') {
      show(index + 1);
      event.preventDefault();
    }
  });

  // Free the decoded image when the lightbox closes.
  dialog.addEventListener('close', () => {
    view.removeAttribute('src');
  });
})();
