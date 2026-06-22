
CREATE TABLE IF NOT EXISTS public.times (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    pontos_acumulados INT DEFAULT 0,
    vitorias_acumuladas INT DEFAULT 0,
    gols_marcados INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.partidas (
    id SERIAL PRIMARY KEY,
    time_casa_id INT REFERENCES public.times(id) ON DELETE CASCADE,
    time_visitante_id INT REFERENCES public.times(id) ON DELETE CASCADE,
    gols_casa INT DEFAULT 0,
    gols_visitante INT DEFAULT 0,
    status VARCHAR(20) DEFAULT 'AGENDADO'
);


CREATE OR REPLACE FUNCTION validar_times_diferentes()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.time_casa_id = NEW.time_visitante_id THEN
        RAISE EXCEPTION 'Operação bloqueada pelo Trigger: Um time não pode jogar contra si mesmo!';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger que executa antes de inserir uma nova partida
DROP TRIGGER IF EXISTS trg_validar_partida ON public.partidas;
CREATE TRIGGER trg_validar_partida
BEFORE INSERT ON public.partidas
FOR EACH ROW
EXECUTE FUNCTION validar_times_diferentes();

CREATE OR REPLACE FUNCTION obter_classificacao()
RETURNS TABLE (
    id_time INT,
    nome_time VARCHAR,
    pontos INT,
    vitorias INT,
    gols_pro INT
) AS $$
BEGIN
    RETURN QUERY
    SELECT t.id, t.nome, t.pontos_acumulados, t.vitorias_acumuladas, t.gols_marcados
    FROM public.times t
    ORDER BY t.pontos_acumulados DESC, t.vitorias_acumuladas DESC, t.gols_marcados DESC;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION encerrar_partida_sumula(
    p_partida_id INT,
    p_gols_casa INT,
    p_gols_visitante INT
) RETURNS void AS $$
DECLARE
    v_time_casa_id INT;
    v_time_visitante_id INT;
    v_status VARCHAR;
BEGIN
    -- Busca informações (SELECT)
    SELECT time_casa_id, time_visitante_id, status 
    INTO v_time_casa_id, v_time_visitante_id, v_status
    FROM public.partidas WHERE id = p_partida_id;

    -- Validação de Rollback condicional
    IF v_time_casa_id IS NULL OR v_time_visitante_id IS NULL THEN
        RAISE EXCEPTION 'Partida não encontrada na base de dados!';
    END IF;
    IF v_status = 'FINALIZADO' THEN
        RAISE EXCEPTION 'Esta partida já foi encerrada anteriormente!';
    END IF;

    -- Bloco de modificações (UPDATEs acorrentados da transação)
    UPDATE public.partidas 
    SET gols_casa = p_gols_casa, gols_visitante = p_gols_visitante, status = 'FINALIZADO'
    WHERE id = p_partida_id;

    UPDATE public.times SET gols_marcados = gols_marcados + p_gols_casa WHERE id = v_time_casa_id;
    UPDATE public.times SET gols_marcados = gols_marcados + p_gols_visitante WHERE id = v_time_visitante_id;

    IF p_gols_casa > p_gols_visitante THEN
        UPDATE public.times SET pontos_acumulados = pontos_acumulados + 3, vitorias_acumuladas = vitorias_acumuladas + 1 WHERE id = v_time_casa_id;
    ELSIF p_gols_visitante > p_gols_casa THEN
        UPDATE public.times SET pontos_acumulados = pontos_acumulados + 3, vitorias_acumuladas = vitorias_acumuladas + 1 WHERE id = v_time_visitante_id;
    ELSE
        UPDATE public.times SET pontos_acumulados = pontos_acumulados + 1 WHERE id = v_time_casa_id;
        UPDATE public.times SET pontos_acumulados = pontos_acumulados + 1 WHERE id = v_time_visitante_id;
    END IF;

EXCEPTION WHEN OTHERS THEN
    -- Captura qualquer erro, o Postgres faz o ROLLBACK do bloco e aborta
    RAISE EXCEPTION 'Rollback ativado: Erro ao processar súmula. Transação desfeita.';
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE PROCEDURE procedure_resetar_campeonato() 
AS $$
BEGIN
    -- 1. Reseta os status das partidas
    UPDATE public.partidas SET gols_casa = 0, gols_visitante = 0, status = 'AGENDADO';
    
    -- 2. Zera as pontuações dos times
    UPDATE public.times SET pontos_acumulados = 0, vitorias_acumuladas = 0, gols_marcados = 0;

    -- Confirma a transação explicitamente se todas as etapas passarem
    COMMIT;
    
EXCEPTION WHEN OTHERS THEN
    -- Desfaz todas as alterações de tabelas em caso de falha
    ROLLBACK;
    RAISE EXCEPTION 'Ocorreu um erro no reset do campeonato. Operação cancelada.';
END;
$$ LANGUAGE plpgsql;
