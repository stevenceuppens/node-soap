/*
 * Copyright (c) 2011 Vinay Pulim <vinay@milewise.com>
 * MIT Licensed
 */

"use strict";

var url = require('url');
var httpreq = require('httpreq');
var async = require('async');
var ntlm = require('httpntlm').ntlm;

var VERSION = require('../package.json').version;

var g_ntlm_options;

exports.request = function(rurl, data, callback, exheaders, exoptions, ntlm_options) {

  if(!g_ntlm_options)
    g_ntlm_options = ntlm_options;

  var curl = url.parse(rurl);
  var secure = curl.protocol === 'https:';
  var host = curl.hostname;
  var port = parseInt(curl.port || (secure ? 443 : 80));
  var path = [curl.pathname || '/', curl.search || '', curl.hash || ''].join('');
  var method = data ? "POST" : "GET";
  var headers = {
    "User-Agent": "node-soap/" + VERSION,
    "Accept" : "text/html,application/xhtml+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
    "Accept-Encoding": "none",
    "Accept-Charset": "utf-8",
    "Connection": "close",
    "Host" : host + (port ? ":"+port : "")
  };
  var attr;

  if (typeof data === 'string') {
    headers["Content-Length"] = Buffer.byteLength(data, 'utf8');
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }

  exheaders = exheaders || {};
  for (attr in exheaders) { headers[attr] = exheaders[attr]; }

  var options = {
    url: curl,
    method: method,
    headers: headers
  };
   
  exoptions = exoptions || {};
  for (attr in exoptions) { options[attr] = exoptions[attr]; }

  options.body = data;

  doNtlmRequest(options, g_ntlm_options, callback);
  
};

function doRequest(options, callback) {

  httpreq.doRequest(options, function(error, res) {
    if (error) {
      callback(error);
    } else {
      callback(null, res, res.body);
    }
  });
};

function doNtlmRequest(options, ntlm_options, callback) {

  if(!ntlm_options.workstation) ntlm_options.workstation = '';
  if(!ntlm_options.domain) ntlm_options.domain = '';

  // is https?
  var isHttps = false;
  var reqUrl = url.parse(options.url);
  if(reqUrl.protocol == 'https:') isHttps = true;

  // set keepaliveAgent (http or https):
  var keepaliveAgent;

  if(isHttps){
    var HttpsAgent = require('agentkeepalive').HttpsAgent;
    keepaliveAgent = new HttpsAgent();
  }else{
    var Agent = require('agentkeepalive');
    keepaliveAgent = new Agent();
  }

  async.waterfall([
    function ($){
      var type1msg = ntlm.createType1Message(ntlm_options);

      httpreq.get(options.url, {
        headers:{
          'Connection' : 'keep-alive',
          'Authorization': type1msg
        },
        agent: keepaliveAgent
      }, $);
    },

    function (res, $){
      if(!res.headers['www-authenticate'])
        return $(new Error('www-authenticate not found on response of second request'));

      var type2msg = ntlm.parseType2Message(res.headers['www-authenticate']);
      var type3msg = ntlm.createType3Message(type2msg, ntlm_options);

      httpreq.doRequest({
        url: options.url,
        headers:{
          'Connection' : 'Close',
          'Authorization': type3msg,
          'Content-Type': 'text/xml'
        },
        method: options.method,
        allowRedirects: false,
        agent: keepaliveAgent,
        body: options.body
      }, $);
    }
  ], function(err, res) {

    if(!err && res)
      callback(null, res, res.body);
    else
      callback("data error", null, null);
  });
};