import React, { useState, useEffect } from 'react';
import './App.css';
import { supabase } from './supabaseClient';

export default function App() {
  const [activeTab, setActiveTab] = useState('painel');

  // ESTADOS GERAIS
  const [times, setTimes] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Carrega a classificação do banco usando a function obter_classificacao()
  const fetchClassificacao = async () => {
    setIsLoading(true);
    const { data, error } = await supabase.rpc('obter_classificacao');
    
    if (error) {
      console.error('Erro ao buscar classificação:', error);
    } else {
      // Os retornos da function são: id_time, nome_time, pontos, vitorias, gols_pro
      setTimes(data || []);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchClassificacao();
  }, []);

  // ESTADO DA TELA 1 (Painel)
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [novoTimeNome, setNovoTimeNome] = useState('');

  const cadastrarTime = async () => {
    if (!novoTimeNome.trim()) return;
    
    // Insere no Supabase (colunas default: pontos_acumulados=0, vitorias_acumuladas=0, gols_marcados=0)
    const { error } = await supabase.from('times').insert([
      { nome: novoTimeNome }
    ]);

    if (error) {
      console.error('Erro ao cadastrar time:', error);
      alert('Erro ao cadastrar time: ' + error.message);
      return;
    }

    setNovoTimeNome('');
    setIsModalOpen(false);
    fetchClassificacao(); // Atualiza a tabela com o novo time
  };

  const deletarTime = async (id_time) => {
    // Delete do Supabase
    const { error } = await supabase.from('times').delete().eq('id', id_time);
    if (error) {
      console.error('Erro ao deletar time:', error);
      alert('Erro ao deletar time. Verifique se ele não tem partidas vinculadas.');
    } else {
      fetchClassificacao(); // Atualiza a tabela
    }
  };

  // ESTADO DA TELA 2 (Súmula)
  const [partidasAgendadas, setPartidasAgendadas] = useState([]);
  const [partidaAtual, setPartidaAtual] = useState(null); // { id, time_casa_id, time_visitante_id, gols_casa, gols_visitante, status }
  const [transacaoStatus, setTransacaoStatus] = useState(null); // { tipo: 'sucesso' | 'erro', mensagem: string }
  const [isModalPartidaOpen, setIsModalPartidaOpen] = useState(false);
  const [timeCasaSelecionado, setTimeCasaSelecionado] = useState('');
  const [timeVisitanteSelecionado, setTimeVisitanteSelecionado] = useState('');

  const fetchPartidasAgendadas = async () => {
    // Busca todas as partidas com status 'AGENDADO'
    const { data, error } = await supabase
      .from('partidas')
      .select('*')
      .eq('status', 'AGENDADO')
      .order('id', { ascending: true });

    if (error) {
      console.error('Erro ao buscar partidas:', error);
    } else {
      setPartidasAgendadas(data || []);
      // Seleciona a primeira partida automaticamente se houver
      if (data && data.length > 0) {
        setPartidaAtual({ ...data[0], gols_casa: 0, gols_visitante: 0 });
      } else {
        setPartidaAtual(null);
      }
    }
  };

  useEffect(() => {
    if (activeTab === 'sumula') {
      fetchPartidasAgendadas();
      setTransacaoStatus(null);
    }
  }, [activeTab]);

  // Cria uma partida selecionada manualmente
  const agendarPartidaManual = async () => {
    if (!timeCasaSelecionado || !timeVisitanteSelecionado) {
      alert('Selecione os dois times para a partida!');
      return;
    }
    if (timeCasaSelecionado === timeVisitanteSelecionado) {
      alert('Um time não pode jogar contra si mesmo!');
      return;
    }

    const { error } = await supabase.from('partidas').insert([{
      time_casa_id: timeCasaSelecionado,
      time_visitante_id: timeVisitanteSelecionado,
      gols_casa: 0,
      gols_visitante: 0,
      status: 'AGENDADO'
    }]);

    if (error) {
      console.error('Erro ao agendar partida:', error);
      alert('Erro ao agendar partida: ' + error.message);
    } else {
      setIsModalPartidaOpen(false);
      setTimeCasaSelecionado('');
      setTimeVisitanteSelecionado('');
      fetchPartidasAgendadas(); // Recarrega a tela com a nova partida
    }
  };

  // Procedure encerrar_partida_sumula()
  const encerrar_partida_sumula = async () => {
    if (!partidaAtual) return;

    // Chama o Procedure via RPC (O Supabase/PostgREST expõe procedures pelo rpc também na versão recente)
    // Argumentos do PostgreSQL: p_partida_id, p_gols_casa, p_gols_visitante
    const { error } = await supabase.rpc('encerrar_partida_sumula', {
      p_partida_id: partidaAtual.id,
      p_gols_casa: partidaAtual.gols_casa,
      p_gols_visitante: partidaAtual.gols_visitante
    });

    if (error) {
      console.error('Erro na transação de súmula:', error);
      setTransacaoStatus({
        tipo: 'erro',
        mensagem: `❌ ERRO (Rollback Ativado): Transação abortada. ${error.message || 'Erro no banco de dados.'}`
      });
    } else {
      // Sucesso no Commit
      setPartidaAtual({ ...partidaAtual, status: 'FINALIZADO' });
      setTransacaoStatus({
        tipo: 'sucesso',
        mensagem: '✅ SUCESSO (Commit Realizado): Partida finalizada com sucesso! Pontuações e saldo de gols atualizados na tabela de classificação geral.'
      });
      // Atualiza a tabela de classificação em background
      fetchClassificacao();
    }
  };

  const atualizarGols = (time, incremento) => {
    if (!partidaAtual || partidaAtual.status === 'FINALIZADO') return;
    setPartidaAtual(prev => {
      const field = time === 'casa' ? 'gols_casa' : 'gols_visitante';
      const novoValor = prev[field] + incremento;
      if (novoValor < 0) return prev;
      return { ...prev, [field]: novoValor };
    });
  };

  // Encontra os nomes dos times a partir do array 'times' carregado no painel
  // (Ou fallback se não tiver carregado)
  const nomeTimeCasa = partidaAtual 
    ? (times.find(t => t.id_time === partidaAtual.time_casa_id)?.nome_time || `Time ID ${partidaAtual.time_casa_id}`)
    : 'Aguardando...';
  
  const nomeTimeVisitante = partidaAtual 
    ? (times.find(t => t.id_time === partidaAtual.time_visitante_id)?.nome_time || `Time ID ${partidaAtual.time_visitante_id}`)
    : 'Aguardando...';

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Gestão Esportiva</h1>
      </header>

      <nav className="tab-navigation">
        <button 
          className={`tab-btn ${activeTab === 'painel' ? 'active' : ''}`}
          onClick={() => setActiveTab('painel')}
        >
          📊 Painel do Campeonato
        </button>
        <button 
          className={`tab-btn ${activeTab === 'sumula' ? 'active' : ''}`}
          onClick={() => setActiveTab('sumula')}
        >
          📝 Súmula Digital
        </button>
      </nav>

      <main className="main-content">
        {activeTab === 'painel' && (
          <section className="painel-section">
            <div className="painel-header">
              <h2>Tabela de Classificação Oficial</h2>
              <button className="btn-primary" onClick={() => setIsModalOpen(true)}>
                + Cadastrar Novo Time
              </button>
            </div>

            <div className="table-container">
              <table className="classificacao-table">
                <thead>
                  <tr>
                    <th>Posição</th>
                    <th className="align-left">Time</th>
                    <th>Pontos</th>
                    <th>Vitórias</th>
                    <th>Gols Pró</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan="6" className="text-center">Carregando classificação do Supabase...</td></tr>
                  ) : times.length === 0 ? (
                    <tr><td colSpan="6" className="text-center">Nenhum time cadastrado no banco de dados.</td></tr>
                  ) : (
                    times.map((time, index) => (
                      <tr key={time.id_time}>
                        <td>{index + 1}º</td>
                        <td className="align-left">{time.nome_time}</td>
                        <td className="destaque-pontos">{time.pontos}</td>
                        <td>{time.vitorias}</td>
                        <td>{time.gols_pro}</td>
                        <td>
                          <button className="btn-delete" onClick={() => deletarTime(time.id_time)} title="Excluir time">
                            🗑️
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {isModalOpen && (
              <div className="modal-overlay">
                <div className="modal-content">
                  <h3>Cadastrar Time</h3>
                  <input 
                    type="text" 
                    placeholder="Nome da Equipe" 
                    value={novoTimeNome}
                    onChange={(e) => setNovoTimeNome(e.target.value)}
                  />
                  <div className="modal-actions">
                    <button className="btn-secondary" onClick={() => setIsModalOpen(false)}>Cancelar</button>
                    <button className="btn-primary" onClick={cadastrarTime}>Salvar Time</button>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {activeTab === 'sumula' && (
          <section className="sumula-section">
            {!partidaAtual ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem', marginTop: '2rem' }}>
                <div className="status-box erro">
                  Nenhuma partida com status 'AGENDADO' foi encontrada na base de dados do Supabase. 
                </div>
                {times.length >= 2 ? (
                  <button className="btn-primary" onClick={() => setIsModalPartidaOpen(true)}>
                    + Agendar Nova Partida
                  </button>
                ) : (
                  <p style={{ color: 'var(--color-text-secondary)' }}>Cadastre pelo menos 2 times na aba do Painel para poder simular uma partida.</p>
                )}
              </div>
            ) : (
              <>
                <div className="partida-selector-info" style={{ color: '#aaa', marginBottom: '-2rem' }}>
                  Partida ID: {partidaAtual.id}
                </div>
                
                <div className="placar-container">
                  <div className="time-box">
                    <h3 className="time-nome">{nomeTimeCasa}</h3>
                    <div className="placar-numero">{partidaAtual.gols_casa}</div>
                    <div className="controles-gols">
                      <button onClick={() => atualizarGols('casa', -1)} disabled={partidaAtual.status === 'FINALIZADO'}>-</button>
                      <button onClick={() => atualizarGols('casa', 1)} disabled={partidaAtual.status === 'FINALIZADO'}>+</button>
                    </div>
                  </div>

                  <div className="vs-badge">VS</div>

                  <div className="time-box">
                    <h3 className="time-nome">{nomeTimeVisitante}</h3>
                    <div className="placar-numero">{partidaAtual.gols_visitante}</div>
                    <div className="controles-gols">
                      <button onClick={() => atualizarGols('visitante', -1)} disabled={partidaAtual.status === 'FINALIZADO'}>-</button>
                      <button onClick={() => atualizarGols('visitante', 1)} disabled={partidaAtual.status === 'FINALIZADO'}>+</button>
                    </div>
                  </div>
                </div>

                <div className="actions-container">
                  <button 
                    className="btn-encerrar" 
                    onClick={encerrar_partida_sumula}
                    disabled={partidaAtual.status === 'FINALIZADO'}
                  >
                    🚀 ENCERRAR PARTIDA E ENVIAR SÚMULA
                  </button>
                </div>

                {transacaoStatus && (
                  <div className={`status-box ${transacaoStatus.tipo}`}>
                    {transacaoStatus.mensagem}
                  </div>
                )}
              </>
            )}

            {isModalPartidaOpen && (
              <div className="modal-overlay">
                <div className="modal-content">
                  <h3>Agendar Nova Partida</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
                    <select 
                      value={timeCasaSelecionado} 
                      onChange={(e) => setTimeCasaSelecionado(e.target.value)}
                      style={{ padding: '1rem', borderRadius: '12px', background: 'var(--bg-body)', color: 'var(--color-text)', border: '1px solid rgba(255,255,255,0.1)', fontSize: '1rem', outline: 'none' }}
                    >
                      <option value="">Selecione o Time da Casa</option>
                      {times.map(t => <option key={t.id_time} value={t.id_time}>{t.nome_time}</option>)}
                    </select>
                    <select 
                      value={timeVisitanteSelecionado} 
                      onChange={(e) => setTimeVisitanteSelecionado(e.target.value)}
                      style={{ padding: '1rem', borderRadius: '12px', background: 'var(--bg-body)', color: 'var(--color-text)', border: '1px solid rgba(255,255,255,0.1)', fontSize: '1rem', outline: 'none' }}
                    >
                      <option value="">Selecione o Time Visitante</option>
                      {times.map(t => <option key={t.id_time} value={t.id_time}>{t.nome_time}</option>)}
                    </select>
                  </div>
                  <div className="modal-actions">
                    <button className="btn-secondary" onClick={() => setIsModalPartidaOpen(false)}>Cancelar</button>
                    <button className="btn-primary" onClick={agendarPartidaManual}>Salvar Partida</button>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
