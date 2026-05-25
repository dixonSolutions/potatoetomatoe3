# GitHub Pages Deployment

This workflow automatically builds and deploys your SvelteKit app to GitHub Pages when you push to the `main` branch.

## Setup Instructions

1. **Enable GitHub Pages:**
   - Go to your repository Settings
   - Navigate to Pages (under "Code and automation")
   - Under "Build and deployment":
     - Source: Select "GitHub Actions"

2. **Push to main branch:**
   ```bash
   git add .
   git commit -m "Deploy to GitHub Pages"
   git push origin main
   ```

3. **Your site will be available at:**
   - `https://<username>.github.io/<repository-name>/`
   - Or your custom domain if configured

## What happens on push:

1. ✅ Checks out your code
2. ✅ Sets up Node.js and pnpm
3. ✅ Installs dependencies (with caching for speed)
4. ✅ Generates games list
5. ✅ Builds the SvelteKit app
6. ✅ Deploys to GitHub Pages

## Manual deployment:

You can also trigger deployment manually from the Actions tab in your repository.

## Base Path Configuration:

If your repo is named something other than `<username>.github.io`, you'll need to set the base path:

1. Go to repository Settings → Secrets and variables → Actions
2. Add a new variable: `BASE_PATH` with value `/your-repo-name`

Or update `svelte.config.js` directly with your repo name.
