/**
 * @file
 * Written by Henri MEDOT <henri.medot[AT]absyx[DOT]fr>
 * http://www.absyx.fr
 *
 * Inspired by Resumable.js
 * http://resumablejs.com
 *
 * Released under the GPLv2 license.
 */

(function(undefined) {
  'use strict';

  // Helper and private functions.
  var extend = function(target) {
    var args = arguments, len = args.length, i, source, name;
    for (i = 1; i < len; i++) {
      source = args[i];
      for (name in source) {
        target[name] = source[name];
      }
    }
    return target;
  };

  var arrayEach = function(array, callback) {
    for (var i = 0, len = array.length; i < len && callback(array[i]) !== false; i++);
  };

  var arrayPos = function(value, array) {
    for (var i = 0, len = array.length; i < len; i++) {
      if (array[i] === value) {
        return i;
      }
    }
    return -1;
  };

  var addEventListener = function(target, type, listener) {
    target.addEventListener(type, listener, false);
  };

  var preventEventDefault = function(e) {
    e.preventDefault();
  };

  var now = function() {
    return (new Date()).getTime();
  };

  var addFiles = function(r, _files) {
    var options = r.options, max = options.maxFiles;
    var files = r.files;
    var addedFiles = [];

    arrayEach(_files, function(_file) {
      var addedFilesLength = addedFiles.length;
      if (max == 1 && addedFilesLength || max > 1 && files.length + addedFilesLength == max) {
        return false;
      }
      var file = new ResupFile(r, _file);
      if (!r.getFileById(file.id)) {
        var error;

        var size = file.size, maxFileSize = options.maxFileSize;
        if (!size || maxFileSize && size > maxFileSize) {
          error = 'size';
        }
        else {
          var extensions = options.extensions;
          if (extensions && arrayPos(file.extension, extensions) < 0) {
            error = 'extension';
          }
        }

        if (error) {
          triggerEvent(r, 'resupaddedfileerror', [file, error]);
        }
        else {
          var fileValidator = options.fileValidator;
          if (!fileValidator || fileValidator(file)) {
            addedFiles.push(file);
          }
        }
      }
    });

    var addedFilesLength = addedFiles.length;
    if (addedFilesLength) {
      if (max == 1 && files.length) {
        var uploading = r.uploading;
        r.stop();
        r.removeFile(files[0]);
        r.uploading = uploading;
      }
      r.files = files.concat(addedFiles);
      resetQueue(r);
    }

    triggerEvent(r, 'resupfilesadded', [addedFiles, _files.length - addedFilesLength]);
  };

  var resetQueue = function(r) {
    if (r.uploading) {
      r.t0 = 0;
      triggerProgress(r);

      var queue = r.queue = [];
      var count = 0, max = r.options.maxRequests;
      arrayEach(r.files, function(file) {
        if (file.xhr) {
          count++;
        }
        else {
          queue.push(file);
        }
      });

      if (!count && !queue.length) {
        uploadEnded(r);
      }
      else {
        while (count < max && queue.length) {
          runFile(queue.shift());
          count++;
        }
      }
    }
  };

  var runQueue = function(file) {
    var r = file.r;
    if (r.uploading) {
      triggerProgress(r);

      var queue = r.queue;
      if (file.status & 0x01) { // 'prepare' or 'upload'
        if (file.retries < 4) {
          queue.push(file);
        }
        else {
          file.status = 0x08; // 'error'
          triggerEvent(r, 'resupfileerror', [file]);
          resetQueue(r);
          return;
        }
      }

      var next = queue.shift();
      if (next) {
        runFile(next);
      }
      else {
        var files = r.files, len = files.length, i;
        for (i = 0; i < len; i++) {
          if (files[i].xhr) {
            return;
          }
        }
        uploadEnded(r);
      }
    }
  };

  var uploadEnded = function(r) {
    r.uploading = false;
    var completeFiles = [], failedFiles = [];
    arrayEach(r.files, function(file) {
      (file.status == 0x04 ? completeFiles : failedFiles).push(file); // 'complete'
    });
    triggerEvent(r, 'resupended', [completeFiles, failedFiles]);
  };

  var triggerProgress = function(r) {
    triggerEvent(r, 'resupprogress');
  };

  var runFile = function(file) {
    var status = file.status;
    if (status & 0x0C) { // 'complete' or 'error'
      runQueue(file);
      return;
    }

    var r = file.r, options = r.options;
    var url = r.url;
    var params = extend({}, options.query, {
      resup_file_id: file.id
    }), name;
    var xhr = new XMLHttpRequest();
    addEventListener(xhr, 'loadstart', function() {
      file.xhrp = 0;
      file.xhr = xhr;
    });
    addEventListener(xhr, 'loadend', function() {
      file.xhr = null;
      if (xhr.status != 200) {
        if (!file.sa) {
          file.retries++;
          runQueue(file);
        }
      }
      else {
        var uploadedChunks = xhr.responseText;
        if (/^\d+$/.test(uploadedChunks)) {
          uploadedChunks = +uploadedChunks;
          if (file.status == 0x03) { // 'upload'
            if (uploadedChunks == file.uploadedChunks + 1) {
              file.retries = 0;
            }
            else {
              r.t0 = 0;
              file.retries++;
            }
          }
          file.uploadedChunks = uploadedChunks;
          file.status = uploadedChunks == file.totalChunks ? 0x04 : 0x03; // 'complete' : 'upload'
        }
        else {
          file.retries++;
          file.status = 0x01; // 'prepare'
        }
        runQueue(file);
      }
    });

    switch (status) {
      case 0x00: // 'pending'
        file.status = 0x01; // 'prepare'
      case 0x01: // 'prepare'
        extend(params, {
          resup_file_name: file.name,
          resup_file_size: file.size
        });
        var pairs = [];
        for (name in params) {
          pairs.push(name + '=' + encodeURIComponent(params[name]));
        }
        xhr.open('GET', url + (url.indexOf('?') < 0 ? '?' : '&') + pairs.join('&') + '&_' + now());
        xhr.timeout = 10000;
        xhr.send();
        break;

      case 0x03: // 'upload'
        addEventListener(xhr.upload, 'progress', function(e) {
          if (e.lengthComputable) {
            var uploaded = file.xhrb = e.loaded;
            file.xhrp = uploaded / e.total;
            triggerProgress(r);
          }
        });
        var uploadedChunks = file.uploadedChunks;
        var chunkSize = options.chunkSize;
        var start = uploadedChunks * chunkSize;
        var formData = new FormData();
        extend(params, {
          resup_file_id: file.id,
          resup_chunk_number: uploadedChunks + 1
        });
        for (name in params) {
          formData.append(name, params[name]);
        }
        formData.append(options.inputName, file._file.slice(start, uploadedChunks < file.totalChunks - 1 ? start + chunkSize : file.size));
        xhr.open('POST', url);
        xhr.send(formData);
    }
  };

  var abortFile = function(file) {
    var xhr = file.xhr;
    if (xhr) {
      file.sa = true;
      xhr.abort();
      file.sa = false;
      file.xhr = null;
    }
  };

  var triggerEvent = function(r, type, args) {
    var handler = r['on' + type];
    if (handler) {
      handler.apply(r, args);
    }
  };
  //~Helper and private functions.



  // Resup class.
  var Resup = window.Resup = function(url, _options) {
    var r = this;

    // Other possible options are:
    // maxFiles, maxFileSize, extensions, fileValidator, drop
    var options = r.options = extend({
      inputName: 'resup_chunk',
      chunkSize: 1 * 1024 * 1024,
      maxRequests: 3,
      query: {}
    }, _options || {});
    var drop = options.drop;

    // r.input
    var max = options.maxFiles;
    var input = r.input = document.createElement('input');
    input.type = 'file';
    input.multiple = max == null || max > 1;
    addEventListener(input, 'change', function() {
      addFiles(r, input.files);
      input.value = '';
    });

    // Other properties are: r.queue, r.uploading, r.t0, r.p0
    r.url = url;
    r.files = [];

    if (drop) {
      addEventListener(drop, 'dragover', preventEventDefault);
      addEventListener(drop, 'drop', function(e) {
        addFiles(r, e.dataTransfer.files);
        preventEventDefault(e);
      });
    }
  };

  // Resup.support, File.prototype.slice()
  var und = typeof undefined;
  var support = typeof File !== und && typeof FileList !== und && typeof FormData !== und;
  if (support) {
    var Fp = File.prototype, slice = Fp.webkitSlice || Fp.mozSlice || Fp.slice;
    support = !!slice;
    Fp.slice = slice;
  }
  Resup.support = support;

  // Resup.prototype.upload()
  var Rp = Resup.prototype;
  Rp.upload = function() {
    var r = this;
    if (!r.uploading && r.files.length) {
      r.uploading = true;
      resetQueue(r);
    }
  };

  // Resup.prototype.retry()
  Rp.retry = function() {
    var r = this, found;
    arrayEach(r.files, function(file) {
      file.retries = 0;
      if (file.status == 0x08) { // 'error'
        file.status = 0x00; // 'pending'
        found = true;
      }
    });
    if (found) {
      resetQueue(r);
    }
    r.upload();
  };

  // Resup.prototype.stop()
  Rp.stop = function() {
    var r = this;
    if (r.uploading) {
      r.uploading = false;
      arrayEach(r.files, abortFile);
    }
  };

  // Resup.prototype.removeFile()
  Rp.removeFile = function(file) {
    var r = this, files = r.files;
    var i = arrayPos(file, files);
    if (i > -1) {
      abortFile(file);
      files.splice(i, 1);
      resetQueue(r);
    }
  };

  // Resup.prototype.getFileById()
  Rp.getFileById = function(id) {
    var files = this.files, len = files.length, i, file;
    for (i = 0; i < len; i++) {
      file = files[i];
      if (file.id == id) {
        return file;
      }
    }
  };

  // Resup.prototype.getProgress()
  Rp.getProgress = function() {
    var total = 0, uploaded = 0;
    arrayEach(this.files, function(file) {
      if (file.status < 0x08 ) { // not 'error'
        total += file.totalChunks;
        uploaded += file.uploadedChunks;
        var xhrProgress = file.xhrp;
        if (file.xhr && xhrProgress) {
          uploaded += xhrProgress;
        }
      }
    });
    return total ? uploaded / total : 0;
  };

  // Resup.prototype.getTime()
  Rp.getTime = function() {
    var r = this;
    if (r.uploading) {
      var t0 = r.t0, p0 = r.p0;
      var t = now(), p;
      var total = 0, uploaded = 0;
      var chunkSize = r.options.chunkSize;
      var files = r.files, len = files.length, i, file, status, size, uploadedChunks;
      for (i = 0; i < len; i++) {
        file = files[i];
        status = file.status;
        if (status <= 0x01) { // 'pending' or 'prepare'
          r.t0 = 0;
          return -1;
        }
        if (status < 0x08) { // not 'error'
          size = file.size;
          total += size;
          uploadedChunks = file.uploadedChunks;
          uploaded += uploadedChunks < file.totalChunks ? uploadedChunks * chunkSize + (file.xhr && file.xhrp ? file.xhrb : 0) : size;
        }
      }
      p = uploaded / total;
      if (t0) {
        return p > p0 ? Math.round((t - t0) * (1 - p) / (p - p0) / 1000) : -1;
      }
      r.t0 = t;
      r.p0 = p;
    }
    return -1;
  };
  //~Resup class.



  // ResupFile class.
  var ResupFile = function(r, _file) {
    var file = this;

    // Other properties are: file.xhr, file.xhrp, file.sa, file.xhrb
    file.r = r;
    file._file = _file;
    file.name = _file.fileName || _file.name;
    file.size = _file.fileSize || _file.size;
    file.date = _file.lastModifiedDate;
    file.uploadedChunks = 0;
    file.status = 0x00; // 'pending'
    file.retries = 0;

    // file.extension
    var parts = file.name.split('.'), len = parts.length;
    file.extension = len > 1 ? parts[len - 1].toLowerCase() : '';

    // file.id
    var time = 0, date = file.date;
    if (date instanceof Date) {
      var time = date.getTime();
      if (now() - time < 1000) {
        time = 0;
      }
    }
    file.id = [file.size, time, encodeURIComponent(file.name).replace(/[^\w%]/g, function(match) {
      return '%' + match.charCodeAt(0).toString(16).toUpperCase();
    })].join('-');

    // file.totalChunks
    file.totalChunks = Math.ceil(file.size / r.options.chunkSize);
  };
  //~ResupFile class.

})();
