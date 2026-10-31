# Tag Impianto

Web app PWA per **cercare i tag** (pompe, valvole, strumenti…) su foto/schermate DCS e **evidenziarli** sulla mappa corretta.

Progetto **separato** da MyMenu: nessun codice condiviso, nessun rischio di rompere il menu.

## Funzioni

- Ricerca tag con suggerimenti
- Highlight luminoso + zoom sulla zona
- Più mappe impianto (select in alto)
- Modalità **Annota**: tap per aggiungere tag, trascina i box per affinare
- **Note** su ogni tag
- Offline: IndexedDB + service worker
- **Firestore / Storage** quando configuri Firebase

## Avvio locale

Serve un server HTTP (i moduli ES non partono da `file://`).

```bash
npx --yes serve -p 5173
```

Apri `http://localhost:5173`.

## Firebase (progetto dedicato)

1. Crea un progetto Firebase (es. `tag-impianto`).
2. Attiva **Firestore**, **Storage**, **Hosting**.
3. Incolla la config in `js/firebase-config.js`.
4. Deploy regole e hosting:

```bash
firebase deploy
```

Collezioni usate:

- `tagImpianto_maps/{mapId}`
- `tagImpianto_maps/{mapId}/tags/{tagId}`
- Storage: `tagImpianto/maps/...`

Finché la config è placeholder, l’app resta **solo locale** (seed Sediflottatore B incluso).

## Prima mappa

`assets/maps/sediflottatore-b.png` + seed in `data/sediflottatore-b.json`.

Le coordinate iniziali sono di primo tiro: usa **Annota** / trascina i box e **Salva**, poi **Sync** per il cloud.
