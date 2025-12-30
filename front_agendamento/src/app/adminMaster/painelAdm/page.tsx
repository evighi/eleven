"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { FileDown, Loader2 } from "lucide-react";

/**
 * ✅  ADMINISTRATIVO (fiel ao print)
 * - ÍCONES: troque o `iconSrc` de cada item
 * - ROTAS: troque o `href` de cada item
 * - "Exportar resumo em pdf": apenas visual (sem ação)
 */

type SummaryCard = {
    label: string;
    value: string;
    iconSrc: string;
    href?: string;
};

type ActionCard = {
    label: string;
    href: string;
    iconSrc: string;
};

// ✅ ALTERE AQUI os caminhos
const HREF_USUARIOS_CADASTRADOS = "/adminMaster/usuarios/perfis";
const HREF_PROFESSORES_CADASTRADOS = "/adminMaster/professores";

// 8 cards por linha
const resumoLinha1Base: SummaryCard[] = [
    {
        label: "Usuários cadastrados",
        value: "—",
        iconSrc: "/icons/icone-permanente.png",
        href: HREF_USUARIOS_CADASTRADOS,
    },
    // ✅ este card vai mostrar a MÉDIA DOS ÚLTIMOS 30 DIAS (mediaLogins)
    { label: "Acessos diários", value: "—", iconSrc: "/icons/icone-permanente.png" },

    { label: "Total esportes", value: "—", iconSrc: "/icons/media2.png" },
    { label: "Total quadras", value: "—", iconSrc: "/icons/media.png" },
    { label: "Total churrasqueiras", value: "—", iconSrc: "/icons/churrasqueiras.png" },
    {
        label: "Professores",
        value: "—",
        iconSrc: "/icons/professores.png",
        href: HREF_PROFESSORES_CADASTRADOS,
    },
    { label: "Média agendamento", value: "—", iconSrc: "/icons/media2.png" },
    { label: "", value: "", iconSrc: "/icons/branco.png" },
];

const resumoLinha2: SummaryCard[] = [
    { label: "Total clientes", value: "1002", iconSrc: "/icons/branco.png" },
    { label: "Total usuários", value: "700", iconSrc: "/icons/branco.png" },
    { label: "Total esportes", value: "05", iconSrc: "/icons/branco.png" },
    { label: "Total quadras", value: "17", iconSrc: "/icons/branco.png" },
    { label: "Tipos de quadra", value: "03", iconSrc: "/icons/branco.png" },
    { label: "Tipos de chamada", value: "06", iconSrc: "/icons/branco.png" },
    { label: "Tipos de cliente", value: "08", iconSrc: "/icons/branco.png" },
    { label: "Tipos de contato", value: "08", iconSrc: "/icons/branco.png" },
];

const configuracoesGerais: ActionCard[] = [
    { label: "Bloqueio de\nquadras", href: "/adminMaster/bloqueioQuadras", iconSrc: "/icons/iconbloq.png" },
    { label: "Notificações", href: "/adminMaster/notificacoes", iconSrc: "/icons/branco.png" },
    { label: "Contador de\nhoras", href: "/adminMaster/contador-horas", iconSrc: "/icons/branco.png" },
];

const editarUsuarios: ActionCard[] = [
    { label: "Exclusões\nPendentes", href: "/adminMaster/usuarios/pendencias", iconSrc: "/icons/pendencias.png" },
    { label: "Cadastrar\nUsuário", href: "/adminMaster/usuarios/criacaoUser", iconSrc: "/icons/icone-permanente.png" },
    { label: "Registros", href: "/adminMaster/logs", iconSrc: "/icons/logs.png" },
    { label: "Empresas", href: "/adminMaster/usuarios/empresas", iconSrc: "/icons/branco.png" },
];

const editarQuadras: ActionCard[] = [
    { label: "Editar\nquadras", href: "/adminMaster/quadras/editarQuadras", iconSrc: "/icons/editarquadra.png" },
    { label: "Cadastrar\nquadra", href: "/adminMaster/quadras/cadastrarQuadras", iconSrc: "/icons/cadastrarquadras.png" },
    { label: "Excluir\nquadra", href: "/adminMaster/quadras/excluirQuadras", iconSrc: "/icons/excluirquadras.png" },
    { label: "Editar\nPermanentes", href: "/adminMaster/todosHorariosPermanentes", iconSrc: "/icons/editarquadra.png" },
];

const editarEsportes: ActionCard[] = [
    { label: "Editar\nesporte", href: "/adminMaster/esportes/editarEsportes", iconSrc: "/icons/editaresportes.png" },
    { label: "Cadastrar\nesporte", href: "/adminMaster/esportes/cadastrarEsportes", iconSrc: "/icons/cadastraresportes.png" },
    { label: "Excluir\nesporte", href: "/adminMaster/esportes/excluirEsportes", iconSrc: "/icons/excluiresportes.png" },
];

const editarChurrasqueiras: ActionCard[] = [
    { label: "Editar\nchurrasqueiras", href: "/adminMaster/churrasqueiras/editarChurrasqueiras", iconSrc: "/icons/editarchurrasqueira.png" },
    { label: "Cadastrar\nchurrasqueira", href: "/adminMaster/churrasqueiras/cadastrarChurrasqueiras", iconSrc: "/icons/cadastrarchurrasqueira.png" },
    { label: "Excluir\nchurrasqueira", href: "/adminMaster/churrasqueiras/excluirChurrasqueiras", iconSrc: "/icons/excluirchurrasqueira.png" },
    { label: "Editar\nPermanentes", href: "/adminMaster/todosHorariosPermanentes", iconSrc: "/icons/editarchurrasqueira.png" },
];

const editarPatrocinadores: ActionCard[] = [
    { label: "Cadastrar\npatrocinador", href: "/adminMaster/patrocinadores/cadastrar", iconSrc: "/icons/branco.png" },
    { label: "Excluir\npatrocinador", href: "/adminMaster/patrocinadores/excluir", iconSrc: "/icons/branco.png" },
    { label: "Lista\npatrocinadores", href: "/adminMaster/patrocinadores", iconSrc: "/icons/branco.png" },
];

function ExportPdfVisual() {
    return (
        <button
            type="button"
            disabled
            className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-600 cursor-default select-none"
            title="Apenas visual por enquanto"
        >
            <FileDown className="w-3.5 h-3.5" />
            <span className="underline underline-offset-2">Exportar resumo em pdf</span>
        </button>
    );
}

function SummaryMiniCard({ item }: { item: SummaryCard }) {
    const cardInner = (
        <div
            className={[
                "bg-[#F3F3F3] rounded-lg px-3 py-3 flex flex-col items-center justify-center text-center min-h-[78px]",
                item.href ? "hover:bg-orange-50/60 transition cursor-pointer" : "",
            ].join(" ")}
            title={item.href ? "Abrir" : undefined}
        >
            <div className="w-9 h-12 rounded-full flex items-center justify-center">
                <Image src={item.iconSrc} alt={item.label} width={48} height={48} className="w-[48px] h-[48px] object-contain" />
            </div>

            <div className="mt-1 text-[12px] font-semibold leading-none flex items-center justify-center min-h-[14px]">
                {item.value === "__loading__" ? <Loader2 className="w-4 h-4 animate-spin text-gray-600" /> : item.value}
            </div>

            <div className="mt-1 text-[9px] leading-tight whitespace-pre-line">{item.label}</div>
        </div>
    );

    if (item.href) return <Link href={item.href}>{cardInner}</Link>;
    return cardInner;
}

function ActionGridCard({ item }: { item: ActionCard }) {
    return (
        <Link
            href={item.href}
            className="bg-gray-100 rounded-lg border border-gray-300 shadow-[0_1px_0_rgba(0,0,0,0.04)] hover:bg-orange-50/40 transition
                 px-3 py-3 flex flex-col items-center justify-center text-center min-h-[88px]"
        >
            <div className="w-10 h-10 rounded-full flex items-center justify-center border-gray-200">
                <Image src={item.iconSrc} alt={item.label} width={48} height={48} className="w-[48px] h-[48px] object-contain" />
            </div>

            <div className="mt-2 text-[10px] whitespace-pre-line leading-tight">{item.label}</div>
        </Link>
    );
}

function SectionBox({
    title,
    right,
    children,
}: {
    title: string;
    right?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <h3 className="text-[13px] font-semibold text-gray-700">{title}</h3>
                {right ?? <div />}
            </div>

            <div className="bg-gray-100 rounded-lg p-4">{children}</div>
        </div>
    );
}

type UsuariosAdminResp = { total: number; usuarios: any[] };

type AgendamentosResumoResp = {
    totalAteHoje: number;
    diasComAgendamento: number;
    mediaPorDia: number;
    detalhesPorDia: { data: string; total: number }[];
};

type LoginsResumoResp = {
    totalAteHoje: number;
    diasComLogin: number;
    mediaPorDia: number;
    detalhesPorDia: { data: string; total: number }[];
    intervalo?: { from: string; to: string };
};

type TotalResp = { total: number };

export default function AdminMasterDashboardPage() {
    const API_URL = process.env.NEXT_PUBLIC_URL_API || "http://localhost:3001";

    const [totalUsuarios, setTotalUsuarios] = useState<string>("__loading__");
    const [mediaAgendamento, setMediaAgendamento] = useState<string>("__loading__");

    const [totalEsportes, setTotalEsportes] = useState<string>("__loading__");
    const [totalQuadras, setTotalQuadras] = useState<string>("__loading__");
    const [totalChurrasqueiras, setTotalChurrasqueiras] = useState<string>("__loading__");
    const [totalProfessores, setTotalProfessores] = useState<string>("__loading__");

    // ✅ média de logins (últimos 30 dias)
    const [mediaLogins30d, setMediaLogins30d] = useState<string>("__loading__");

    useEffect(() => {
        let mounted = true;

        const carregarTudo = async () => {
            try {
                const [
                    usuariosResp,
                    agResumoResp,
                    esportesResp,
                    quadrasResp,
                    churrasResp,
                    profsResp,
                    logins30Resp,
                ] = await Promise.all([
                    axios.get<UsuariosAdminResp>(`${API_URL}/usuariosAdmin`, { withCredentials: true }),
                    axios.get<AgendamentosResumoResp>(`${API_URL}/agendamentos/estatisticas/resumo`, { withCredentials: true }),
                    axios.get<TotalResp>(`${API_URL}/esportes/total`, { withCredentials: true }),
                    axios.get<TotalResp>(`${API_URL}/quadras/total`, { withCredentials: true }),
                    axios.get<TotalResp>(`${API_URL}/churrasqueiras/total`, { withCredentials: true }),
                    axios.get<TotalResp>(`${API_URL}/professores/total`, { withCredentials: true }),

                    // ✅ AGORA: últimos 30 dias (bem mais leve e é o que você quer)
                    axios.get<LoginsResumoResp>(`${API_URL}/login/estatisticas/logins/resumo?days=30`, {
                        withCredentials: true,
                    }),
                ]);

                if (!mounted) return;

                setTotalUsuarios(String(usuariosResp.data?.total ?? 0));

                const mediaAg = Number(agResumoResp.data?.mediaPorDia ?? 0);
                setMediaAgendamento(String(Math.round(mediaAg)));

                setTotalEsportes(String(esportesResp.data?.total ?? 0));
                setTotalQuadras(String(quadrasResp.data?.total ?? 0));
                setTotalChurrasqueiras(String(churrasResp.data?.total ?? 0));
                setTotalProfessores(String(profsResp.data?.total ?? 0));

                const mediaLg30 = Number(logins30Resp.data?.mediaPorDia ?? 0);
                setMediaLogins30d(String(Math.round(mediaLg30)));
            } catch (err) {
                console.error("Erro ao carregar resumo do painel:", err);
                if (!mounted) return;

                setTotalUsuarios((v) => (v === "__loading__" ? "—" : v));
                setMediaAgendamento((v) => (v === "__loading__" ? "—" : v));
                setTotalEsportes((v) => (v === "__loading__" ? "—" : v));
                setTotalQuadras((v) => (v === "__loading__" ? "—" : v));
                setTotalChurrasqueiras((v) => (v === "__loading__" ? "—" : v));
                setTotalProfessores((v) => (v === "__loading__" ? "—" : v));
                setMediaLogins30d((v) => (v === "__loading__" ? "—" : v));
            }
        };

        carregarTudo();

        return () => {
            mounted = false;
        };
    }, [API_URL]);

    const resumoLinha1 = useMemo(() => {
        return resumoLinha1Base.map((c) => {
            if (c.label === "Usuários cadastrados") return { ...c, value: totalUsuarios };

            // ✅ aqui é onde a UI vai mostrar a média dos últimos 30 dias
            if (c.label === "Acessos diários") return { ...c, value: mediaLogins30d };

            if (c.label === "Média agendamento") return { ...c, value: mediaAgendamento };
            if (c.label === "Total esportes") return { ...c, value: totalEsportes };
            if (c.label === "Total quadras") return { ...c, value: totalQuadras };
            if (c.label === "Total churrasqueiras") return { ...c, value: totalChurrasqueiras };
            if (c.label === "Professores") return { ...c, value: totalProfessores };
            return c;
        });
    }, [totalUsuarios, mediaAgendamento, totalEsportes, totalQuadras, totalChurrasqueiras, totalProfessores, mediaLogins30d]);

    return (
        <div className="min-h-screen">
            <main className="mx-auto max-w-6xl px-4 py-6">
                <div className="mb-4">
                    <h1 className="text-[32px] font-bold text-orange-600 leading-tight">Painel administrativo</h1>
                    <p className="text-[16px] text-gray-500 -mt-0.5">Administrador Master</p>
                </div>

                <div className="flex items-center justify-between mb-2">
                    <h2 className="text-[13px] font-semibold text-gray-700">Resumo de cadastros</h2>
                    <ExportPdfVisual />
                </div>

                <div className="space-y-3">
                    <div className="grid grid-cols-4 md:grid-cols-8 gap-3">
                        {resumoLinha1.map((item) => (
                            <SummaryMiniCard key={`${item.label}-1`} item={item} />
                        ))}
                    </div>
                </div>

                <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <SectionBox title="Configurações Gerais" right={<ExportPdfVisual />}>
                        <div className="grid grid-cols-3 gap-3">
                            {configuracoesGerais.map((item) => (
                                <ActionGridCard key={item.label} item={item} />
                            ))}
                        </div>
                    </SectionBox>

                    <SectionBox title="Editar Usuários" right={<ExportPdfVisual />}>
                        <div className="grid grid-cols-4 gap-3">
                            {editarUsuarios.map((item) => (
                                <ActionGridCard key={item.label} item={item} />
                            ))}
                        </div>
                    </SectionBox>
                </div>

                <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <SectionBox title="Editar quadras" right={<ExportPdfVisual />}>
                        <div className="grid grid-cols-4 gap-3">
                            {editarQuadras.map((item) => (
                                <ActionGridCard key={item.label} item={item} />
                            ))}
                        </div>
                    </SectionBox>

                    <SectionBox title="Editar esportes" right={<ExportPdfVisual />}>
                        <div className="grid grid-cols-3 gap-3">
                            {editarEsportes.map((item) => (
                                <ActionGridCard key={item.label} item={item} />
                            ))}
                        </div>
                    </SectionBox>
                </div>

                <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <SectionBox title="Editar Churrasqueiras" right={<ExportPdfVisual />}>
                        <div className="grid grid-cols-4 gap-3">
                            {editarChurrasqueiras.map((item) => (
                                <ActionGridCard key={item.label} item={item} />
                            ))}
                        </div>
                    </SectionBox>

                    <SectionBox title="Patrocinadores" right={<ExportPdfVisual />}>
                        <div className="grid grid-cols-3 gap-3">
                            {editarPatrocinadores.map((item) => (
                                <ActionGridCard key={item.label} item={item} />
                            ))}
                        </div>
                    </SectionBox>
                </div>
            </main>
        </div>
    );
}
