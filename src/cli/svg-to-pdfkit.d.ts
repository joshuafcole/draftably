declare module 'svg-to-pdfkit' {
  interface Options {
    width?: number;
    height?: number;
    assumePt?: boolean;
    fontCallback?: (family: string, bold: boolean, italic: boolean) => string;
    warningCallback?: (warning: string) => void;
  }
  export default function SVGtoPDF(
    doc: PDFKit.PDFDocument,
    svg: string,
    x: number,
    y: number,
    options?: Options,
  ): void;
}
