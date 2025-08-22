// src/app/admin/master/esportes/cadastrar/page.tsx
import FormularioCadastroQuadras from "@/components/FormularioQuadras";

export default function PageCadastroEsporte() {
  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-4">Cadastrar Quadra</h2>
      <FormularioCadastroQuadras />
    </div>
  );
}