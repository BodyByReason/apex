create or replace package zoom_pkg as
  function get_access_token(p_user_id in varchar2) return varchar2;
  function create_meeting(
    p_user_id         in varchar2,
    p_topic           in varchar2,
    p_start_time_utc  in timestamp with time zone,
    p_duration_min    in number
  ) return clob;
end zoom_pkg;
/
create or replace package body zoom_pkg as
  function app_setting(p_name in varchar2) return varchar2 is
  begin
    return apex_app_setting.get_value(p_name => p_name);
  end;

  function b64(p_text in varchar2) return varchar2 is
  begin
    return replace(
             replace(
               utl_raw.cast_to_varchar2(
                 utl_encode.base64_encode(utl_raw.cast_to_raw(p_text))
               ),
               chr(10),
               ''
             ),
             chr(13),
             ''
           );
  end;

  function json_scalar(p_json in clob, p_path in varchar2) return varchar2 is
    l_value varchar2(4000);
  begin
    select json_value(p_json, p_path returning varchar2(4000) null on empty null on error)
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
        -20090,
        p_context || ' failed. HTTP ' || apex_web_service.g_status_code || ': ' ||
        dbms_lob.substr(p_response, 3000, 1)
      );
    end if;
  end;

  function parse_tstz(p_value in varchar2) return timestamp with time zone is
  begin
    if p_value is null then
      return null;
    end if;

    begin
      return to_timestamp_tz(p_value, 'YYYY-MM-DD"T"HH24:MI:SS.FFTZH:TZM');
    exception
      when others then
        begin
          return to_timestamp_tz(p_value, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM');
        exception
          when others then
            return to_timestamp_tz(p_value, 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
        end;
    end;
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

  procedure save_tokens(
    p_user_id           in varchar2,
    p_access_token      in varchar2,
    p_refresh_token     in varchar2,
    p_token_expires_at  in timestamp with time zone
  ) is
    l_body clob;
    l_resp clob;
  begin
    apex_json.initialize_clob_output;
    apex_json.open_object;
    apex_json.write('access_token', p_access_token);
    if p_refresh_token is not null then
      apex_json.write('refresh_token', p_refresh_token);
    end if;
    if p_token_expires_at is not null then
      apex_json.write(
        'token_expires_at',
        to_char(
          p_token_expires_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS"Z"'
        )
      );
    end if;
    apex_json.close_object;
    l_body := apex_json.get_clob_output;
    apex_json.free_output;

    l_resp := supabase_request(
      'PATCH',
      '/rest/v1/zoom_connections?user_id=eq.' || p_user_id,
      l_body
    );
  end;

  function get_connection_row(p_user_id in varchar2) return clob is
    l_resp clob;
  begin
    l_resp := supabase_request(
      'GET',
      '/rest/v1/zoom_connections?user_id=eq.' || p_user_id || '&select=*'
    );

    if json_exists(l_resp, '$[0]') then
      return l_resp;
    end if;

    raise_application_error(-20001, 'No Zoom connection found for user ' || p_user_id);
  end;

  function get_access_token(p_user_id in varchar2) return varchar2 is
    l_row_json         clob;
    l_app_type         varchar2(30);
    l_access_token     varchar2(32767);
    l_refresh_token    varchar2(32767);
    l_zoom_account_id  varchar2(200);
    l_token_expires_at timestamp with time zone;
    l_resp             clob;
    l_basic            varchar2(32767);
    l_new_access       varchar2(32767);
    l_new_refresh      varchar2(32767);
    l_expires_in       number;
  begin
    l_row_json := get_connection_row(p_user_id);

    l_app_type         := json_scalar(l_row_json, '$[0].app_type');
    l_access_token     := json_scalar(l_row_json, '$[0].access_token');
    l_refresh_token    := json_scalar(l_row_json, '$[0].refresh_token');
    l_zoom_account_id  := json_scalar(l_row_json, '$[0].zoom_account_id');
    l_token_expires_at := parse_tstz(json_scalar(l_row_json, '$[0].token_expires_at'));

    if l_access_token is not null
       and l_token_expires_at is not null
       and l_token_expires_at > (systimestamp at time zone 'UTC') + interval '5' minute then
      return l_access_token;
    end if;

    l_basic := 'Basic ' || b64(app_setting('ZOOM_CLIENT_ID') || ':' || app_setting('ZOOM_CLIENT_SECRET'));

    apex_web_service.g_request_headers.delete;
    apex_web_service.g_request_headers(1).name  := 'Authorization';
    apex_web_service.g_request_headers(1).value := l_basic;
    apex_web_service.g_request_headers(2).name  := 'Content-Type';
    apex_web_service.g_request_headers(2).value := 'application/x-www-form-urlencoded';

    if l_app_type = 'oauth_user' then
      l_resp := apex_web_service.make_rest_request(
        p_url         => 'https://zoom.us/oauth/token?grant_type=refresh_token&refresh_token=' ||
                         apex_util.url_encode(l_refresh_token),
        p_http_method => 'POST'
      );
    elsif l_app_type = 'oauth_s2s' then
      l_resp := apex_web_service.make_rest_request(
        p_url         => 'https://zoom.us/oauth/token?grant_type=account_credentials&account_id=' ||
                         apex_util.url_encode(coalesce(l_zoom_account_id, app_setting('ZOOM_S2S_ACCOUNT_ID'))),
        p_http_method => 'POST'
      );
    else
      raise_application_error(-20002, 'Unsupported Zoom app_type: ' || l_app_type);
    end if;

    assert_http_ok(l_resp, 'Zoom token request');

    l_new_access  := json_scalar(l_resp, '$.access_token');
    l_new_refresh := coalesce(json_scalar(l_resp, '$.refresh_token'), l_refresh_token);
    l_expires_in  := to_number(json_scalar(l_resp, '$.expires_in'));

    if l_new_access is null then
      raise_application_error(-20003, 'Zoom token request failed: ' || dbms_lob.substr(l_resp, 4000, 1));
    end if;

    save_tokens(
      p_user_id          => p_user_id,
      p_access_token     => l_new_access,
      p_refresh_token    => l_new_refresh,
      p_token_expires_at => (systimestamp at time zone 'UTC') + numtodsinterval(l_expires_in, 'SECOND')
    );

    return l_new_access;
  end;

  function create_meeting(
    p_user_id         in varchar2,
    p_topic           in varchar2,
    p_start_time_utc  in timestamp with time zone,
    p_duration_min    in number
  ) return clob is
    l_row_json      clob;
    l_zoom_user_id  varchar2(4000);
    l_access_token  varchar2(32767);
    l_body          clob;
    l_resp          clob;
  begin
    l_row_json     := get_connection_row(p_user_id);
    l_zoom_user_id := json_scalar(l_row_json, '$[0].zoom_user_id');
    l_access_token := get_access_token(p_user_id);

    apex_json.initialize_clob_output;
    apex_json.open_object;
    apex_json.write('topic', p_topic);
    apex_json.write('type', 2);
    apex_json.write(
      'start_time',
      to_char(p_start_time_utc at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    );
    apex_json.write('duration', p_duration_min);
    apex_json.write('timezone', 'UTC');
    apex_json.open_object('settings');
    apex_json.write('join_before_host', false);
    apex_json.write('waiting_room', true);
    apex_json.close_object;
    apex_json.close_object;
    l_body := apex_json.get_clob_output;
    apex_json.free_output;

    apex_web_service.g_request_headers.delete;
    apex_web_service.g_request_headers(1).name  := 'Authorization';
    apex_web_service.g_request_headers(1).value := 'Bearer ' || l_access_token;
    apex_web_service.g_request_headers(2).name  := 'Content-Type';
    apex_web_service.g_request_headers(2).value := 'application/json';

    l_resp := apex_web_service.make_rest_request(
      p_url         => 'https://api.zoom.us/v2/users/' || apex_util.url_encode(l_zoom_user_id) || '/meetings',
      p_http_method => 'POST',
      p_body        => l_body
    );

    assert_http_ok(l_resp, 'Zoom meeting creation');

    if json_scalar(l_resp, '$.id') is null then
      raise_application_error(-20004, 'Zoom meeting creation failed: ' || dbms_lob.substr(l_resp, 4000, 1));
    end if;

    return l_resp;
  end;
end zoom_pkg;
/
