create or replace package live_coaching_pkg as
  function find_active_link_id(
    p_coach_user_id  in varchar2,
    p_client_user_id in varchar2
  ) return varchar2;

  function find_open_session_id(
    p_coach_user_id  in varchar2,
    p_client_user_id in varchar2
  ) return varchar2;

  function create_session(
    p_coach_user_id      in varchar2,
    p_client_user_id     in varchar2,
    p_link_id            in varchar2,
    p_zoom_meeting_id    in varchar2,
    p_zoom_meeting_uuid  in varchar2,
    p_zoom_join_url      in varchar2,
    p_zoom_start_url     in varchar2,
    p_status             in varchar2,
    p_scheduled_start    in timestamp with time zone,
    p_actual_start       in timestamp with time zone,
    p_scheduled_via      in varchar2,
    p_metadata_source    in varchar2
  ) return varchar2;

  function get_session_json(p_session_id in varchar2) return clob;

  procedure complete_session(
    p_session_id      in varchar2,
    p_coach_user_id   out varchar2,
    p_client_user_id  out varchar2,
    p_live_count      out number,
    p_duration_min    out number
  );

  procedure update_next_session(
    p_link_id       in varchar2,
    p_next_session  in timestamp with time zone
  );

  procedure award_achievement(
    p_user_id in varchar2,
    p_code    in varchar2,
    p_count   in number
  );

  procedure mark_celebration_shown(
    p_session_id in varchar2
  );
end live_coaching_pkg;
/
create or replace package body live_coaching_pkg as
  function app_setting(p_name in varchar2) return varchar2 is
  begin
    return apex_app_setting.get_value(p_name => p_name);
  end;

  function json_scalar(p_json in clob, p_path in varchar2) return varchar2 is
    l_value varchar2(4000);
  begin
    select json_value(p_json, p_path returning varchar2(4000) null on empty null on error)
      into l_value
      from dual;
    return l_value;
  end;

  function json_number(p_json in clob, p_path in varchar2) return number is
    l_value number;
  begin
    select json_value(p_json, p_path returning number null on empty null on error)
      into l_value
      from dual;
    return l_value;
  end;

  procedure assert_http_ok(
    p_response    in clob,
    p_context     in varchar2,
    p_status_low  in number default 200,
    p_status_high in number default 299
  ) is
  begin
    if apex_web_service.g_status_code < p_status_low
       or apex_web_service.g_status_code > p_status_high then
      raise_application_error(
        -20190,
        p_context || ' failed. HTTP ' || apex_web_service.g_status_code || ': ' ||
        dbms_lob.substr(p_response, 3000, 1)
      );
    end if;
  end;

  function supabase_request(
    p_method in varchar2,
    p_path   in varchar2,
    p_body   in clob default null
  ) return clob is
    l_resp clob;
    l_url  varchar2(32767) := rtrim(app_setting('SUPABASE_URL'), '/') || p_path;
  begin
    apex_web_service.g_request_headers.delete;
    apex_web_service.g_request_headers(1).name  := 'apikey';
    apex_web_service.g_request_headers(1).value := app_setting('SUPABASE_SERVICE_ROLE_KEY');
    apex_web_service.g_request_headers(2).name  := 'Authorization';
    apex_web_service.g_request_headers(2).value := 'Bearer ' || app_setting('SUPABASE_SERVICE_ROLE_KEY');
    apex_web_service.g_request_headers(3).name  := 'Content-Type';
    apex_web_service.g_request_headers(3).value := 'application/json';
    apex_web_service.g_request_headers(4).name  := 'Prefer';
    apex_web_service.g_request_headers(4).value := 'return=representation';

    l_resp := apex_web_service.make_rest_request(
      p_url         => l_url,
      p_http_method => p_method,
      p_body        => p_body
    );

    assert_http_ok(l_resp, 'Supabase request');
    return l_resp;
  end;

  function to_utc_iso(p_ts in timestamp with time zone) return varchar2 is
  begin
    return to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  end;

  function find_active_link_id(
    p_coach_user_id  in varchar2,
    p_client_user_id in varchar2
  ) return varchar2 is
    l_resp clob;
    l_id   varchar2(36);
  begin
    l_resp := supabase_request(
      'GET',
      '/rest/v1/coach_client_links?coach_user_id=eq.' || p_coach_user_id ||
      '&client_user_id=eq.' || p_client_user_id ||
      '&status=eq.active&select=id&limit=1'
    );

    l_id := json_scalar(l_resp, '$[0].id');

    if l_id is null then
      raise_application_error(-20101, 'No active coach_client_link for coach ' || p_coach_user_id || ' and client ' || p_client_user_id);
    end if;

    return l_id;
  end;

  function find_open_session_id(
    p_coach_user_id  in varchar2,
    p_client_user_id in varchar2
  ) return varchar2 is
    l_resp clob;
  begin
    l_resp := supabase_request(
      'GET',
      '/rest/v1/live_coaching_sessions?coach_user_id=eq.' || p_coach_user_id ||
      '&client_user_id=eq.' || p_client_user_id ||
      '&status=in.(scheduled,live)&select=id&order=scheduled_start.desc.nullslast&limit=1'
    );

    return json_scalar(l_resp, '$[0].id');
  end;

  function create_session(
    p_coach_user_id      in varchar2,
    p_client_user_id     in varchar2,
    p_link_id            in varchar2,
    p_zoom_meeting_id    in varchar2,
    p_zoom_meeting_uuid  in varchar2,
    p_zoom_join_url      in varchar2,
    p_zoom_start_url     in varchar2,
    p_status             in varchar2,
    p_scheduled_start    in timestamp with time zone,
    p_actual_start       in timestamp with time zone,
    p_scheduled_via      in varchar2,
    p_metadata_source    in varchar2
  ) return varchar2 is
    l_body clob;
    l_resp clob;
    l_id   varchar2(36);
  begin
    apex_json.initialize_clob_output;
    apex_json.open_object;
    apex_json.write('coach_user_id', p_coach_user_id);
    apex_json.write('client_user_id', p_client_user_id);
    apex_json.write('coach_client_link_id', p_link_id);
    apex_json.write('zoom_meeting_id', p_zoom_meeting_id);
    apex_json.write('zoom_meeting_uuid', p_zoom_meeting_uuid);
    apex_json.write('zoom_join_url', p_zoom_join_url);
    apex_json.write('zoom_start_url', p_zoom_start_url);
    apex_json.write('status', p_status);
    apex_json.write('scheduled_start', to_utc_iso(p_scheduled_start));
    if p_actual_start is not null then
      apex_json.write('actual_start', to_utc_iso(p_actual_start));
    end if;
    apex_json.write('scheduled_via', p_scheduled_via);
    apex_json.open_object('metadata');
    apex_json.write('source', p_metadata_source);
    apex_json.close_object;
    apex_json.close_object;
    l_body := apex_json.get_clob_output;
    apex_json.free_output;

    l_resp := supabase_request(
      'POST',
      '/rest/v1/live_coaching_sessions?select=id',
      l_body
    );

    l_id := json_scalar(l_resp, '$[0].id');

    if l_id is null then
      raise_application_error(-20102, 'Failed to create live_coaching_sessions row: ' || dbms_lob.substr(l_resp, 4000, 1));
    end if;

    return l_id;
  end;

  function get_session_json(p_session_id in varchar2) return clob is
  begin
    return supabase_request(
      'GET',
      '/rest/v1/live_coaching_sessions?id=eq.' || p_session_id || '&select=*'
    );
  end;

  procedure complete_session(
    p_session_id      in varchar2,
    p_coach_user_id   out varchar2,
    p_client_user_id  out varchar2,
    p_live_count      out number,
    p_duration_min    out number
  ) is
    l_body clob;
    l_resp clob;
  begin
    apex_json.initialize_clob_output;
    apex_json.open_object;
    apex_json.write('p_session_id', p_session_id);
    apex_json.close_object;
    l_body := apex_json.get_clob_output;
    apex_json.free_output;

    l_resp := supabase_request(
      'POST',
      '/rest/v1/rpc/complete_live_coaching_session',
      l_body
    );

    p_coach_user_id  := json_scalar(l_resp, '$[0].coach_user_id');
    p_client_user_id := json_scalar(l_resp, '$[0].client_user_id');
    p_live_count     := json_number(l_resp, '$[0].live_count');
    p_duration_min   := json_number(l_resp, '$[0].duration_minutes');

    if p_coach_user_id is null or p_client_user_id is null then
      raise_application_error(-20103, 'Failed to complete session: ' || dbms_lob.substr(l_resp, 4000, 1));
    end if;
  end;

  procedure update_next_session(
    p_link_id       in varchar2,
    p_next_session  in timestamp with time zone
  ) is
    l_body clob;
    l_resp clob;
  begin
    apex_json.initialize_clob_output;
    apex_json.open_object;
    apex_json.write('next_session', to_utc_iso(p_next_session));
    apex_json.close_object;
    l_body := apex_json.get_clob_output;
    apex_json.free_output;

    l_resp := supabase_request(
      'PATCH',
      '/rest/v1/coach_client_links?id=eq.' || p_link_id,
      l_body
    );
  end;

  procedure award_achievement(
    p_user_id in varchar2,
    p_code    in varchar2,
    p_count   in number
  ) is
    l_body clob;
    l_resp clob;
  begin
    apex_json.initialize_clob_output;
    apex_json.open_object;
    apex_json.write('p_user_id', p_user_id);
    apex_json.write('p_achievement_code', p_code);
    apex_json.open_object('p_context');
    apex_json.write('source', 'live_coaching');
    apex_json.write('count', p_count);
    apex_json.close_object;
    apex_json.close_object;
    l_body := apex_json.get_clob_output;
    apex_json.free_output;

    l_resp := supabase_request(
      'POST',
      '/rest/v1/rpc/award_achievement',
      l_body
    );
  end;

  procedure mark_celebration_shown(
    p_session_id in varchar2
  ) is
    l_body clob;
    l_resp clob;
  begin
    apex_json.initialize_clob_output;
    apex_json.open_object;
    apex_json.write('celebration_shown', true);
    apex_json.close_object;
    l_body := apex_json.get_clob_output;
    apex_json.free_output;

    l_resp := supabase_request(
      'PATCH',
      '/rest/v1/live_coaching_sessions?id=eq.' || p_session_id,
      l_body
    );
  end;
end live_coaching_pkg;
/
