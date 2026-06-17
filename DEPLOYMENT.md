# Deployment Guide

## Development Setup

### Prerequisites
- Node.js 16+ installed
- npm or yarn package manager

### Installation & Running
1. Install dependencies:
   ```bash
   npm install
   ```

2. Run the Vite dev server:
   ```bash
   npm run dev
   ```
   The app will be available at `http://localhost:5173` (or the port shown in terminal)

3. The dev server includes the admin API endpoints built-in via middleware.

## Production Deployment

### Backend Server Setup

The backend server allows users (like your neighbors) to login and edit content directly on the server. Changes are saved to disk and persist for all users.

#### Option 1: Local Deployment (Your Own Machine)

1. Build the React app:
   ```bash
   npm run build
   ```
   This creates a `dist/` folder with the compiled app.

2. Create a `.env` file (copy from `.env.example`):
   ```bash
   cp .env.example .env
   ```
   
3. Edit `.env` to set a secure admin password:
   ```
   ADMIN_PASSWORD=your_secure_password_here
   ADMIN_TOKEN=your_secure_token_here
   PORT=3000
   ```

4. Start the backend server:
   ```bash
   npm run server
   ```
   The app will be available at `http://localhost:3000`

5. **For remote access**: Your neighbors can access the website at:
   - `http://your-ip-address:3000` (from the same local network)
   - Or via a service like ngrok for internet-wide access

#### Option 2: Deploy to a Hosting Service

Recommended services for easy deployment:

**Railway** (Simplest):
1. Push your code to GitHub
2. Create a Railway account at https://railway.app
3. Connect your GitHub repo
4. Add environment variables in Railway dashboard:
   - `ADMIN_PASSWORD` = your secure password
   - `ADMIN_TOKEN` = secure token
5. Deploy (automatic on push to main)

**Vercel** (Alternative):
1. Push code to GitHub
2. Import project at https://vercel.com
3. Add environment variables
4. Deploy

**Heroku** (Alternative):
1. Create Heroku account
2. `npm install -g heroku`
3. `heroku login`
4. `heroku create your-app-name`
5. `heroku config:set ADMIN_PASSWORD=secure_password`
6. `git push heroku main`

### How It Works

**Save Flow:**
1. Neighbor logs in with admin password
2. Clicks "Editează textul" to enable editing mode
3. Makes changes (text editing, formatting with Bold/Italic/Font size)
4. Clicks "Salvează" button
5. Content is saved to `data/edited-sections/{sectionId}.html` on the server
6. All users see the updated content immediately on their next page load

**Key Features:**
- No Git required - just server-side file storage
- All edits persist across browser sessions and user sessions
- All users see the same edited version
- Changes are permanent (stored in `data/` folder)

### Backing Up Your Data

Your edited content is stored in `data/edited-sections/` folder. To backup:

```bash
# Create a backup
tar -czf edited-sections-backup-$(date +%Y%m%d).tar.gz data/edited-sections/

# List backups
ls -la *.tar.gz
```

### Changing the Admin Password

1. Edit your `.env` file and change `ADMIN_PASSWORD`
2. Restart the server
3. All previous users will need to log in again with the new password

### Troubleshooting

**Port already in use:**
```bash
# Kill the process using port 3000
lsof -i :3000
kill -9 <PID>

# Or use a different port
PORT=3001 npm run server
```

**CORS errors in browser console:**
- Make sure the backend server is running
- Check that the port is correct
- If accessing from a different domain, the server already handles this

**Changes not persisting:**
- Check that `data/` folder has write permissions
- Verify the `ADMIN_PASSWORD` is correct
- Check server logs for error messages

## Development Workflow

**For you (developer):**
1. Make code changes
2. Run `npm run build` to create production build
3. Run `npm run server` to test locally
4. Deploy to hosting service

**For neighbors (editors):**
1. Visit the website URL
2. Click "Parola admin" button (top right)
3. Enter the admin password you gave them
4. Click chapters to read
5. Click "Editează textul" on the introduction
6. Make changes
7. Click "Salvează" to save

## Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_PASSWORD` | admin123 | Password for admin login |
| `ADMIN_TOKEN` | local-admin-token | Token for authorization (can be any string) |
| `PORT` | 3000 | Server port |
| `NODE_ENV` | (not set) | Set to "production" for production builds |
