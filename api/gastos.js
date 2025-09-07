// api/gastos.js
import { google } from "googleapis";

export async function consultarGastosPorCategoria({ userNumber, categoria, periodo }) {
  const auth = new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    ["https://www.googleapis.com/auth/spreadsheets"]
  );

  const sheets = google.sheets({ version: "v4", auth });

  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: "messages!A:I", // A = timestamp, B = número, C = texto original do usuário, D = resposta
  });

  const linhas = data.values || [];
  const agora = new Date();
  const mesAtual = agora.getMonth();
  const anoAtual = agora.getFullYear();

  let total = 0;

  for (const linha of linhas) {
    const [timestamp, numero, entradaUsuario] = linha;

    if (!timestamp || !numero || !entradaUsuario) continue;

    // Verifica se o número bate com quem está pedindo
    if (numero !== userNumber) continue;

    // Regex para extrair frases como "gastei R$ 50 com gasolina", "gastei 30 reais em mercado", etc.
    const match = entradaUsuario.match(/(gastei|gasto)\s+(R\$|\$)?\s?(\d+[\d.,]*)\s+(em|no|na|com)\s+(.+)/i);
    if (!match) continue;

    const valor = parseFloat(match[3].replace(".", "").replace(",", "."));
    const categoriaInformada = match[5]?.trim().toLowerCase();

    if (!categoriaInformada.includes(categoria.toLowerCase())) continue;

    const dataLinha = new Date(timestamp);
    if (dataLinha.getMonth() !== mesAtual || dataLinha.getFullYear() !== anoAtual) continue;

    total += valor;
  }

  return total;
}
