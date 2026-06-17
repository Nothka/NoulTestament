import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'local-admin-token';

app.use(express.json());

// Serve static files (built React app)
app.use(express.static(path.join(__dirname, 'dist')));
app.use(express.static(path.join(__dirname, 'public')));

// Login endpoint
app.post('/api/admin/login', (req, res) => {
  try {
    const { password } = req.body;

    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Parolă invalidă.' });
    }

    res.json({ token: ADMIN_TOKEN });
  } catch (error) {
    res.status(400).json({ error: 'Eroare la autentificare.' });
  }
});

// Get edited section
app.get('/api/admin/edited-section', async (req, res) => {
  try {
    const { sectionId } = req.query;

    if (!sectionId || typeof sectionId !== 'string') {
      return res.status(400).json({ error: 'sectionId lipsă.' });
    }

    const filePath = path.join(__dirname, 'data', 'edited-sections', `${sectionId}.html`);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      res.setHeader('Content-Type', 'text/html');
      res.send(content);
    } catch (fileError) {
      res.status(404).send('Not found');
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save edited section
app.post('/api/admin/save', (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || authHeader !== `Bearer ${ADMIN_TOKEN}`) {
      return res.status(403).json({ error: 'Autentificare necesară.' });
    }

    const { sectionId, html } = req.body;

    if (!sectionId || !html) {
      return res.status(400).json({ error: 'Payload invalid.' });
    }

    const outputDir = path.join(__dirname, 'data', 'edited-sections');
    
    // Create directory if it doesn't exist
    fs.mkdir(outputDir, { recursive: true })
      .then(() => {
        const filePath = path.join(outputDir, `${sectionId}.html`);
        return fs.writeFile(filePath, html, 'utf-8');
      })
      .then(() => {
        res.json({ message: 'Salvare reușită.' });
      })
      .catch((error) => {
        res.status(500).json({ error: error.message });
      });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Fallback: serve index.html for all other routes (for React Router)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend server running on http://0.0.0.0:${PORT}`);
  console.log(`Public data stored in: ${path.join(__dirname, 'data', 'edited-sections')}`);
});
