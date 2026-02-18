# Contributing to Sync-in

We appreciate your contributions and efforts in making this project better.  
Before you contribute, please read the following guidelines to ensure a smooth collaboration.

## Code of Conduct

All contributors must follow our [Code of Conduct](CODE_OF_CONDUCT.md) to ensure a friendly and inclusive environment.

## How to Contribute

### Reporting Issues & Suggesting Features

#### Bugs

- Check existing issues before opening a new one.
- Include detailed steps, logs, and screenshots when possible.

#### Feature Requests

- Describe the problem the feature solves.
- Provide use cases and, if possible, implementation suggestions.

### Submitting Pull Requests

- Open an issue before submitting any pull request for a new feature or bug fix to avoid duplicate work, ensure alignment with the project’s goals,
  and prevent wasted effort.
- All pull requests must target the main branch, following the GitHub Flow model with continuous deployment.
- Make sure your work fits with the existing architecture, code style, and documentation standards.
- All contributions must comply with the [CLA](CLA.md).
- Contributions are made under the [AGPL-3.0 license](LICENSE), which is the same license used by the project.

#### Submission Guidelines

- Keep pull requests small and focused; avoid addressing multiple unrelated issues in a single PR.
- Ensure all CI checks pass before submitting (linting, type checking, tests, and build).
- Reference the related issue number in the PR description when applicable.
- Include tests and update documentation as needed when introducing new features.
- The PR author is responsible for resolving merge conflicts.
- Use the [Conventional Commits specification](https://www.conventionalcommits.org/) for commit messages; pull requests are squashed on merge.

#### Branching

- **Main**: Production branch; all pull requests must target `main`.
- **Feature branches**: Create a dedicated branch per feature or fix and submit a PR to `main`.

## Development Setup

You will need the following on your system:

- **Git**
- **Node.js with npm**

## Project Structure

The project uses npm workspaces to manage a monorepo with multiple workspaces.
This structure enables shared tooling, coordinated builds, and simplified dependency management.

| Workspace |   Path    | Technology     | Purpose                                          |
|:----------|:---------:|:---------------|:-------------------------------------------------|
| Root      |     /     | npm workspaces | Monorepo orchestration, shared scripts           |
| Core      |   /core   | Node.js        | Shared synchronization components and core logic |
| CLI       |   /cli    | Node.js        | Command-line tool to use sync                    |
| Main      |   /main   | Electron       | Desktop app process used by Electron             |
| Renderer  | /renderer | Angular        | User interface used by `main`, client-side logic |

## Setup Instructions

### Clone the repo

```
git clone git@github.com:Sync-in/desktop.git
cd desktop
```
### Install dependencies

```bash
npm ci
```

### Build App & CLI for development

Run these commands in separate terminals. Both run in watch mode.
```bash
npm run angular:dev # build renderer (dist/renderer)
npm run webpack:all:dev # build app (dist/main) & cli (releases/sync-in-cli)
```

To build only App:
```bash
npm run webpack:app:dev
```

To build only CLI:
```bash
npm run webpack:cli:dev
```

### Start App (dev mode)
```bash
npm run app # restart after code changes in `main`; renderer changes are handled by `angular:dev`
```

### Start CLI (dev mode)
```bash
./releases/sync-in-cli/sync-in-cli-*.js --help
```

**Happy coding!**

## Useful Script

### In the root workspace

- `npm run lint` code linting

## Development Guidelines

- Always write/review tests for new features and bug fixes
- Follow code style rules (`eslint.config.mjs`, `.prettierrc`)
- Prefer clear naming and documentation within your code
- Document significant architectural changes and updates

## Troubleshooting

- **App & CLI:** In dev mode, the default log level is debug.
- **Renderer:** Use Angular DevTools for debugging. Check browser console for runtime errors.

## Useful Links

- [Electron Documentation](https://www.electronjs.org/docs/latest)
- [Angular Documentation](https://angular.dev)
- [Node.js Documentation](https://nodejs.org/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

---

_Thanks again for helping make **Sync-in** better! 🚀_
