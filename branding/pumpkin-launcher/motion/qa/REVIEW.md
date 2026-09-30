# Buddy Motion: Qualitätsprüfung

Die Laufzeit-Assets sind SVGs. Rasterbilder in diesem Ordner dienen ausschließlich der Zeichen- und Bewegungsprüfung.

## Durchgang 1

Posenblatt geprüft: Silhouette, Kontrast, Gesichtsgruppen, Licht, einheitliche Konturen, ganzzahliges Raster und identische 48×48-Bildflächen stimmen. Offene und geschlossene Augen sind jeweils bewusst gestaltet. Es gibt keine 3/4-Perspektive und keine Geh-/Kontaktbewegung; Buddy schwebt. Dither und Anti-Aliasing werden nicht verwendet. Sicherheitsrand und Binäralpha sind automatisch geprüft.

FIX: Die erste kleine Hand las sich eher als Punkt an einem Stiel. Handfläche und Daumen wurden deutlicher gestuft.

## Durchgang 2

Verfeinerte Wink- und Jubelpose im Browser mit Sunny Buddy betrachtet. Hände klarer, Gesicht und Palme lesbar, keine abgeschnittenen Details. Variable Haltezeiten, Vorbewegung vor dem Sprung und ein Pixel Nachlauf an den Accessoires sind vorhanden. Ruhige Bewegungen bleiben bei ±1 Pixel; der ausdrücklich kurze Jubelsprung erreicht vier Pixel Höhe.

SVG-SMIL im Browser geprüft: 128 Beobachtungen über drei vollständige Idle-Zyklen. Jede der sieben Posen wurde gezeigt; zu jedem Zeitpunkt war genau eine Pose sichtbar. Kein leeres Bild und keine Überlagerung am Loop-Ende.

## Durchgang 3

Alle fünf Seasons in `season-poses.png` gegengeprüft. Der Generator validiert für jede Pose Abmessungen, Sicherheitsabstand, Binäralpha und unterschiedliche Bewegungsphasen. Schleifen enden bildgleich zur Anfangspose; einmalige Reaktionen enden in der Originalpose.

Browserprüfung:

- Season-Wechsel lädt alle sechs korrekten SVGs.
- Pause friert die Wiedergabe ein; nicht sichtbare Karten bleiben pausiert.
- Der Zeitregler erreicht die gewählte Pose. Jubel bei 0,60 s zeigt die obere Sprungpose.
- Bei 1,46 s ist die letzte Jubelpose aktiv und referenziert wieder die originale Pose 0.
- Die manuelle Option „Bewegung reduzieren“ pausiert alle sechs SVGs und zeigt deren Poster.
- Ein eigenständig geöffnetes SVG reagiert auf die emulierte Systemeinstellung `prefers-reduced-motion: reduce`: Bewegungsgruppe `display:none`, Poster `display:inline`. Die Emulation wurde danach zurückgesetzt.

SHIP als vorbereitetes, noch nicht integriertes Bewegungsset. Das Runtime-SVG benötigt weder den Skill noch eine JavaScript-Bibliothek.
