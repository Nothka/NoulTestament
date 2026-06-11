import './App.css';

const PDF_URL = '/noul-testament.pdf';

function App() {
  return (
    <main className="app">
      <header className="site-header">
        <div className="site-title">
          <p>Noul Testament</p>
          <h1>al Domnului și Mântuitorului nostru Isus Cristos</h1>
        </div>

        <div className="document-actions" aria-label="Acțiuni document">
          <a className="secondary-action" href={PDF_URL} target="_blank" rel="noreferrer">
            Deschide PDF
          </a>
          <a className="primary-action" href={PDF_URL} download="Noul Testament.pdf">
            Descarcă PDF
          </a>
        </div>
      </header>

      <section className="pdf-shell" aria-label="Noul Testament PDF">
        <object className="pdf-viewer" data={`${PDF_URL}#view=FitH`} type="application/pdf">
          <div className="pdf-fallback">
            <p>PDF-ul nu poate fi afișat în acest browser.</p>
            <a className="primary-action" href={PDF_URL} download="Noul Testament.pdf">
              Descarcă PDF
            </a>
          </div>
        </object>
      </section>
    </main>
  );
}

export default App;
