// ================= KERANGKA: navigasi antar section =================
// Logika ini murni untuk switching UI (kerangka), tidak menyentuh
// logika model KNN atau data — itu bagian Anda isi sendiri nanti.

document.addEventListener('DOMContentLoaded', () => {
    const navlinks = document.querySelectorAll('.navlink');
    const panels = document.querySelectorAll('.panel');
  
    function activate(target) {
      navlinks.forEach(btn => {
        const isTarget = btn.dataset.target === target;
        btn.classList.toggle('is-active', isTarget);
        btn.setAttribute('aria-selected', isTarget ? 'true' : 'false');
      });
  
      panels.forEach(panel => {
        panel.classList.toggle('is-active', panel.id === `panel-${target}`);
      });
  
      // opsional: simpan section aktif di URL supaya bisa di-refresh/bagikan
      history.replaceState(null, '', `#${target}`);
    }
  
    navlinks.forEach(btn => {
      btn.addEventListener('click', () => activate(btn.dataset.target));
    });
  
    // buka section sesuai hash URL saat load (default: knn)
    const initial = window.location.hash.replace('#', '') || 'knn';
    if (document.getElementById(`panel-${initial}`)) {
      activate(initial);
    }
  });