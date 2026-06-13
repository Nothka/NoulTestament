import './App.css';

const PDF_URL = '/noul-testament.pdf';
const PDF_EMBED_URL = `${PDF_URL}#zoom=page-width&toolbar=0&navpanes=0&scrollbar=1`;

function App() {
  return (
    <main className="app">
      <header className="site-header">
        <div className="site-title">
          <p>Noul Testament</p>
          <h1>al Domnului și Mântuitorului nostru Isus Cristos</h1>
        </div>

        <div className="document-actions" aria-label="Acțiuni document">
          <a className="primary-action" href={PDF_URL} download="Noul Testament.pdf">
            Descarcă PDF
          </a>
        </div>
      </header>

      <section className="pdf-shell" aria-label="Noul Testament PDF">
        <iframe
          className="pdf-viewer"
          title="Noul Testament PDF"
          src={PDF_EMBED_URL}
        />
      </section>
    </main>
  );
}

export default App;
