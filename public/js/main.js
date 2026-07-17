document.addEventListener('click', (e) => {
  const copyBtn = e.target.closest('[data-copy]');
  if (copyBtn) {
    const text = copyBtn.getAttribute('data-copy');
    navigator.clipboard.writeText(text).then(() => {
      const original = copyBtn.innerHTML;
      copyBtn.innerHTML = '<svg class="icon"><use href="/icons/sprite.svg#icon-check"></use></svg> Copied';
      setTimeout(() => { copyBtn.innerHTML = original; }, 1600);
    });
  }
});

document.addEventListener('submit', (e) => {
  const form = e.target;
  if (form.hasAttribute('data-confirm')) {
    if (!confirm(form.getAttribute('data-confirm'))) {
      e.preventDefault();
    }
  }
});
