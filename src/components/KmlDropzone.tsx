import { useRef, useState } from 'react';

interface Props {
  fileName?: string;
  onLoad: (text: string, fileName: string) => void;
  onError: (message: string) => void;
}

export function KmlDropzone({ fileName, onLoad, onError }: Props) {
  const [isOver, setIsOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function accept(file: File | undefined) {
    if (!file) return;
    if (!/\.kml$/i.test(file.name)) {
      onError(`"${file.name}" is not a .kml file. Export the map from Google My Maps as KML first.`);
      return;
    }
    try {
      onLoad(await file.text(), file.name);
    } catch {
      onError(`Could not read "${file.name}".`);
    }
  }

  if (fileName) {
    return (
      <div className="file-line">
        <span>
          Loaded <strong>{fileName}</strong>
        </span>
        <button className="secondary" onClick={() => inputRef.current?.click()}>
          Choose a different file
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".kml"
          style={{ display: 'none' }}
          onChange={(e) => accept(e.target.files?.[0])}
        />
      </div>
    );
  }

  return (
    <div
      className={isOver ? 'drop over' : 'drop'}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setIsOver(true);
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsOver(false);
        void accept(e.dataTransfer.files?.[0]);
      }}
    >
      <p style={{ margin: 0 }}>
        Drop a race KML here, or <strong>browse</strong>
      </p>
      <p className="hint" style={{ margin: '0.4rem 0 0' }}>
        Everything is parsed in your browser — nothing is uploaded anywhere.
      </p>
      <input ref={inputRef} type="file" accept=".kml" onChange={(e) => accept(e.target.files?.[0])} />
    </div>
  );
}
