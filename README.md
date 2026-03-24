# Annotation Objets — Extension Trimble Connect 3D Viewer

Extension pour le Viewer 3D de Trimble Connect permettant d'afficher des annotations de propriétés sur les objets sélectionnés d'un modèle 3D.

## Fonctionnalités

- **Consultation des propriétés** : Sélectionnez des objets dans le viewer 3D → toutes les propriétés IFC (Property Sets) s'affichent avec des toggles
- **Annotations 3D** : Activez les propriétés souhaitées → elles apparaissent comme étiquettes textuelles 3D positionnées sur chaque objet
- **Personnalisation** : Couleur, séparateur, affichage horizontal/vertical, unités
- **Regroupement** : Propriétés organisées par Property Set (Pset) avec tri alphabétique
- **Multi-objets** : Annotez jusqu'à 50 objets simultanément

## Stack technique

| Couche | Technologie |
|--------|-------------|
| Framework | React 19 + TypeScript |
| Build | Vite 6 |
| CSS | Tailwind CSS 4 |
| UI | shadcn/ui + Modus 2.0 design tokens |
| Icônes | Lucide React |
| API | Trimble Connect Workspace API (CDN) |

## Développement local

```bash
# Installation des dépendances
npm install

# Lancer le serveur de développement
npm run dev

# Build pour production
npm run build

# Prévisualiser le build
npm run preview
```

En mode développement local (hors iframe Trimble Connect), l'extension utilise des données fictives pour permettre le développement de l'interface sans connexion.

## Déploiement sur Vercel

1. Pousser le code sur un dépôt GitHub
2. Importer le projet dans Vercel (vercel.com → New Project → Import Git Repository)
3. Vercel détecte automatiquement Vite → build & deploy en un clic
4. Récupérer l'URL de déploiement (ex: `https://tc-annotation-object.vercel.app`)

## Installation dans Trimble Connect

1. Ouvrir un projet dans Trimble Connect for Browser
2. Aller dans **Paramètres** → **Extensions**
3. Cliquer **Ajouter une extension personnalisée**
4. Coller l'URL du manifest : `https://<votre-domaine>/manifest.json`
5. Activer l'extension
6. Ouvrir le Viewer 3D → l'extension apparaît dans le panneau latéral

## Structure du projet

```
tc-annotation-object/
├── public/
│   └── manifest.json          # Manifest d'extension TC
├── src/
│   ├── components/
│   │   ├── ui/                # Composants shadcn/ui (Modus themed)
│   │   ├── tabs/              # Onglets de l'extension
│   │   ├── PropertyToggleList.tsx
│   │   ├── ErrorBoundary.tsx
│   │   └── Loader.tsx
│   ├── hooks/
│   │   ├── useTrimbleConnect.ts  # Connexion Workspace API
│   │   ├── useAnnotations.ts     # Gestion des annotations
│   │   └── useSettings.ts        # Paramètres persistants
│   ├── lib/
│   │   ├── viewerBridge.ts       # Abstraction Viewer API + mock
│   │   ├── annotationEngine.ts   # Création/suppression annotations 3D
│   │   └── utils.ts
│   ├── types/
│   │   └── index.ts              # Interfaces TypeScript
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css                 # Tailwind + Modus design tokens
├── index.html
├── package.json
├── vite.config.ts
└── tsconfig.json
```
