'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import axios from 'axios';
import Spinner from '@/components/Spinner';
import { useRequireAuth } from '@/hooks/useRequireAuth';

type PorDia = { data: string; aulas: number; valor: number };
type PorFaixa = { faixa: string; aulas: number; valor: number };
type MesTotais = { aulas: number; valor: number };

// ⬇️ tipos das multas detalhadas vindas do back
type MultaDetalhe = {
  id: string;
  data: string; // ISO datetime
  horario: string; // "HH:MM"
  multa: number;
  quadra?: { id: string; numero: number | null; nome: string | null } | null;
  esporte?: { id: string; nome: string | null } | null;
};

type ResumoResponse = {
  professor: { id: string; nome: string; valorQuadra: number };
  intervalo: { from: string; to: string; duracaoMin: number };
  totais: {
    porDia: PorDia[];
    porFaixa: PorFaixa[];
    mes: MesTotais;
    // ⬇️ novos campos vindos do back
    multaMes?: number;
    valorMesComMulta?: number;
  };
  // ⬇️ novo array de detalhes de multas
  multasDetalhes?: MultaDetalhe[];
};

const currencyBRL = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

const fmtBR = (isoYMD: string) => {
  const [y, m, d] = isoYMD.split('-');
  return `${d}/${m}/${y}`;
};

const fmtDDMM = (isoYMD: string) => {
  const [y, m, d] = isoYMD.split('-');
  return `${d}/${m}`;
};

// normaliza ISO datetime → "YYYY-MM-DD"
const ymdFromISODateTime = (isoDT: string) => (isoDT.includes('T') ? isoDT.split('T')[0] : isoDT);

// exibe "Quadra X" priorizando número, senão nome
const quadraLabel = (q?: MultaDetalhe['quadra']) => {
  if (!q) return '-';
  if (q?.numero != null) return `Quadra ${q.numero}`;
  if (q?.nome) return q.nome;
  return 'Quadra';
};

function getMonthYYYYMM(d = new Date()) {
  // mês atual no fuso de SP
  const y = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
  }).format(d);
  const m = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    month: '2-digit',
  }).format(d);
  return `${y}-${m}`;
}

// gera as 4 faixas do mês e rótulos bonitinhos
function buildFaixasLabels(toDateISO: string) {
  const lastDay = Number(toDateISO.split('-')[2]); // dia do "to"
  const faixas: Array<{ id: string; label: string; fromDay: number; toDay: number }> = [
    { id: '1-7', fromDay: 1, toDay: 7, label: '' },
    { id: '8-14', fromDay: 8, toDay: 14, label: '' },
    { id: '15-21', fromDay: 15, toDay: 21, label: '' },
    { id: `22-${lastDay}`, fromDay: 22, toDay: lastDay, label: '' },
  ];
  return faixas;
}

export default function DetalhesProfessorPage() {
  // só professores (e master pode ver também)
  const { isChecking } = useRequireAuth(['ADMIN_PROFESSORES', 'ADMIN_MASTER']);

  const API_URL = process.env.NEXT_PUBLIC_URL_API || 'http://localhost:3001';

  const [mes, setMes] = useState(getMonthYYYYMM());
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ResumoResponse | null>(null);

  // seleção UI
  const [faixaSel, setFaixaSel] = useState<string>(''); // '1-7', '8-14', ...
  const [diaSel, setDiaSel] = useState<string>(''); // 'YYYY-MM-DD'

  // UI: toggle lista de multas (colapsável)
  const [mostrarMultas, setMostrarMultas] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get<ResumoResponse>(`${API_URL}/professores/me/resumo`, {
        params: { mes },
        withCredentials: true,
      });
      setData(data);

      // defaults de seleção
      const faixas = buildFaixasLabels(data.intervalo.to);
      const primeiraFaixa = faixas[0]?.id || '';
      setFaixaSel(primeiraFaixa);

      // quando definirmos a faixa, o dia será decidido no useEffect abaixo
      setDiaSel('');
      // por padrão: abrir multas se existir pelo menos 1 (experiência mais clara)
      setMostrarMultas((data.multasDetalhes?.length || 0) > 0);
    } catch (e) {
      console.error(e);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [API_URL, mes]);

  useEffect(() => {
    if (isChecking) return;
    void carregar();
  }, [carregar, isChecking]);

  // mapeia faixas -> range de dias
  const faixasInfo = useMemo(() => {
    if (!data) return [];
    const yearMonth = data.intervalo.to.slice(0, 7); // 'YYYY-MM'

    const faixas = buildFaixasLabels(data.intervalo.to).map((f, idx) => {
      const fromISO = `${yearMonth}-${String(f.fromDay).padStart(2, '0')}`;
      const toISO = `${yearMonth}-${String(f.toDay).padStart(2, '0')}`;
      const semanaNum = String(idx + 1).padStart(2, '0');
      const label = `SEMANA ${semanaNum} – ${fmtDDMM(fromISO)} À ${fmtDDMM(toISO)}`;
      return { ...f, label, fromISO, toISO };
    });

    return faixas;
  }, [data]);

  // dias da faixa selecionada (filtra `porDia`)
  const diasDaFaixa = useMemo(() => {
    if (!data || !faixaSel) return [];
    const info = faixasInfo.find((f) => f.id === faixaSel);
    if (!info) return [];
    const inRange = (ymd: string) => {
      const day = Number(ymd.split('-')[2]);
      return day >= info.fromDay && day <= info.toDay;
    };
    return data.totais.porDia.filter((d) => inRange(d.data));
  }, [data, faixaSel, faixasInfo]);

  // set default dia quando troca a faixa
  useEffect(() => {
    if (diaSel) return;
    if (diasDaFaixa.length) {
      setDiaSel(diasDaFaixa[0].data);
    }
  }, [diasDaFaixa, diaSel]);

  // totais da semana selecionada (pega direto do porFaixa da API)
  const totaisSemanaSel = useMemo(() => {
    if (!data || !faixaSel) return { aulas: 0, valor: 0 };
    const f = data.totais.porFaixa.find((x) => x.faixa === faixaSel);
    return f ? { aulas: f.aulas, valor: f.valor } : { aulas: 0, valor: 0 };
  }, [data, faixaSel]);

  // item do dia selecionado
  const diaInfoSel = useMemo(() => {
    if (!diaSel || !diasDaFaixa.length) return null;
    return diasDaFaixa.find((d) => d.data === diaSel) || null;
  }, [diaSel, diasDaFaixa]);

  // helpers de navegação do mês
  const incMes = (delta: number) => {
    const [yStr, mStr] = mes.split('-');
    const y = Number(yStr);
    const m = Number(mStr) - 1;
    const d = new Date(Date.UTC(y, m, 1));
    d.setUTCMonth(d.getUTCMonth() + delta);
    const yy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    setMes(`${yy}-${mm}`);
  };

  if (isChecking) {
    return (
      <main className="min-h-screen grid place-items-center bg-[#f5f5f5]">
        <div className="flex items-center gap-3 text-gray-600">
          <Spinner size="w-8 h-8" /> <span>Carregando…</span>
        </div>
      </main>
    );
  }

  // valores com fallback quando o back ainda não tinha os campos
  const multaMes = Number(data?.totais.multaMes || 0);
  const totalMesSomenteAulas = Number(data?.totais.mes.valor || 0);
  const totalMesComMulta =
    Number.isFinite(Number(data?.totais.valorMesComMulta))
      ? Number(data?.totais.valorMesComMulta)
      : totalMesSomenteAulas + multaMes;

  const multasDetalhes = (data?.multasDetalhes || []).map((m) => ({
    ...m,
    ymd: ymdFromISODateTime(m.data),
  }));

  return (
    <main className="min-h-screen bg-[#f5f5f5]">
      {/* Header */}
      <header className="bg-orange-600 text-white px-4 py-5">
        <div className="max-w-sm mx-auto">
          <h1 className="text-2xl font-extrabold tracking-wide drop-shadow-sm">Reservas Anteriores</h1>

          {/* seletor de mês simples */}
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => incMes(-1)}
              className="rounded-md bg-white/15 hover:bg-white/25 transition px-2 py-1 cursor-pointer"
              aria-label="Mês anterior"
            >
              ‹
            </button>
            <div className="text-sm font-semibold">
              {mes.split('-').reverse().join('/')}
            </div>
            <button
              onClick={() => incMes(1)}
              className="rounded-md bg-white/15 hover:bg-white/25 transition px-2 py-1 cursor-pointer"
              aria-label="Próximo mês"
            >
              ›
            </button>
          </div>
        </div>
      </header>

      <section className="px-4 py-4">
        <div className="max-w-sm mx-auto bg-white rounded-2xl shadow-md p-4">
          <p className="text-[13px] font-semibold text-gray-600 mb-2">
            Quantidade de Aulas marcadas:
          </p>

          {/* estado de carregamento */}
          {loading && (
            <div className="flex items-center gap-2 text-gray-600 mb-3">
              <Spinner /> <span>Carregando resumo…</span>
            </div>
          )}

          {/* erro ou vazio */}
          {!loading && !data && (
            <div className="text-sm text-gray-600">Não foi possível carregar os dados.</div>
          )}

          {/* conteúdo */}
          {!loading && !!data && (
            <>
              {/* Semana */}
              <div className="mb-2">
                <div className="text-[11px] text-gray-500 mb-1">Semanas do mês</div>
                <div className="relative">
                  <select
                    value={faixaSel}
                    onChange={(e) => {
                      setFaixaSel(e.target.value);
                      setDiaSel('');
                    }}
                    className="w-full rounded-md bg-[#f3f3f3] px-3 py-2 text-[13px] font-semibold text-gray-700 cursor-pointer"
                  >
                    {faixasInfo.map((f, i) => (
                      <option key={f.id} value={f.id}>
                        {`SEMANA ${String(i + 1).padStart(2, '0')} — ${fmtDDMM(f.fromISO)} À ${fmtDDMM(f.toISO)}`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Dia da semana selecionada */}
              <div className="mb-2">
                <div className="text-[11px] text-gray-500 mb-1">Dias da semana</div>
                <div className="relative">
                  <select
                    value={diaSel}
                    onChange={(e) => setDiaSel(e.target.value)}
                    className="w-full rounded-md bg-[#f3f3f3] px-3 py-2 text-[13px] font-semibold text-gray-700 cursor-pointer"
                  >
                    {diasDaFaixa.map((d) => (
                      <option key={d.data} value={d.data}>
                        {`Dia: ${fmtBR(d.data)}  |  Aulas: ${String(d.aulas).padStart(2, '0')}`}
                      </option>
                    ))}
                    {diasDaFaixa.length === 0 && <option value="">Sem aulas nesta semana</option>}
                  </select>
                </div>
              </div>

              {/* Linha de dia selecionado */}
              {diaInfoSel && (
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div className="rounded-md bg-gray-100 px-3 py-2 text-[13px] text-gray-600">
                    <span className="opacity-70 mr-1">Dia:</span>
                    <span className="font-semibold">{fmtBR(diaInfoSel.data)}</span>
                  </div>
                  <div className="rounded-md bg-gray-100 px-3 py-2 text-[13px] text-gray-600">
                    <span className="opacity-70 mr-1">Aulas:</span>
                    <span className="font-semibold text-orange-600">{String(diaInfoSel.aulas).padStart(2, '0')}</span>
                  </div>
                </div>
              )}

              {/* Totais da semana */}
              <div className="rounded-md bg-gray-200 px-3 py-2 text-[13px] text-gray-700 mb-2">
                <div className="flex items-center justify-between">
                  <span>Total de Aulas da semana:</span>
                  <span className="font-semibold">{totaisSemanaSel.aulas}</span>
                </div>
              </div>
              <div className="rounded-md bg-gray-200 px-3 py-2 text-[13px] text-gray-700">
                <div className="flex items-center justify-between">
                  <span>Total a pagar da semana:</span>
                  <span className="font-semibold">
                    {currencyBRL(totaisSemanaSel.valor)}
                  </span>
                </div>
              </div>

              {/* Separador */}
              <div className="my-3 border-t border-gray-200" />

              {/* Totais do mês */}
              <div className="rounded-md bg-gray-100 px-3 py-2 text-[13px] text-gray-700">
                <div className="flex items-center justify-between">
                  <span>Total de aulas do mês:</span>
                  <span className="font-semibold">{data.totais.mes.aulas}</span>
                </div>

                <div className="flex items-center justify-between mt-1">
                  <span>Total (aulas):</span>
                  <span className="font-semibold">
                    {currencyBRL(totalMesSomenteAulas)}
                  </span>
                </div>

                {multaMes !== 0 && (
                  <div className="flex items-center justify-between mt-1">
                    <span>Multas do mês:</span>
                    <span className="font-semibold">
                      {currencyBRL(multaMes)}
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between mt-1">
                  <span>Total do mês (com multa):</span>
                  <span className="font-semibold">
                    {currencyBRL(totalMesComMulta)}
                  </span>
                </div>
              </div>

              {/* Multas detalhadas (colapsável) */}
              {multasDetalhes.length > 0 && (
                <div className="mt-3">
                  <button
                    onClick={() => setMostrarMultas(v => !v)}
                    className="w-full flex items-center justify-between rounded-md bg-gray-100 hover:bg-gray-200 transition px-3 py-2 text-[13px] text-gray-700 cursor-pointer"
                    aria-expanded={mostrarMultas}
                  >
                    <span className="font-semibold">
                      Multas do mês ({multasDetalhes.length})
                    </span>
                    <span className="text-gray-500">{mostrarMultas ? '▲' : '▼'}</span>
                  </button>

                  {mostrarMultas && (
                    <ul className="mt-2 divide-y rounded-md border border-gray-200 overflow-hidden">
                      {multasDetalhes.map((m) => (
                        <li key={m.id} className="px-3 py-2 text-[13px] flex flex-col gap-0.5 bg-white">
                          <div className="flex items-center justify-between">
                            <span className="text-gray-700">
                              {fmtBR(m.ymd)} · {m.horario}
                            </span>
                            <span className="font-semibold">{currencyBRL(m.multa)}</span>
                          </div>
                          <div className="text-[12px] text-gray-600">
                            {quadraLabel(m.quadra)}{m.esporte?.nome ? ` · ${m.esporte?.nome}` : ''}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* mini nota de rodapé */}
              <p className="mt-2 text-[11px] text-gray-500">
                Duração considerada por aula: {data.intervalo.duracaoMin} min · Valor por aula: {currencyBRL(data.professor.valorQuadra || 0)}
              </p>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
