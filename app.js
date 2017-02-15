const cfenv = require('cfenv')
const express = require('express')
const request = require('request')
const winston = require('winston')
const mkdirp = require('mkdirp')
const fs = require('fs')
const app = express()

const Cloudant = require('cloudant')
const config = require('./config')
const cloudant = Cloudant({
  account: config.cloudant.username,
  password: config.cloudant.password
})
const db = cloudant.db.use('traffic')

const logger = new (winston.Logger)({
  transports: [
    new (winston.transports.Console)(),
    new (winston.transports.File)({ filename: 'output.log' })
  ]
})

function getFormattedDate() {
  let now = new Date()
  let formatted = now.getDate() + '_' + (now.getMonth() + 1) + '_' + now.getFullYear()
  return formatted
}

function getFormattedHour() {
  let now = new Date()
  let formatted = now.getHours()
  return formatted
}

function saveToCloudant(name, timestamp, date, hour, active) {
  let filename = name + '_' + timestamp
  let document = {
    type: name,
    timestamp: timestamp,
    date: date,
    hour: hour,
    active: active
  }

  db.insert(document, filename, function(err) {
    if (!err) {
      logger.info('inserted ' + filename + ' into Cloudant')
    } else {
      logger.error('failed to insert ' + filename + ' into Cloudant')
      logger.error(err)
    }
  })
}

function createFileStructure(cb) {
  logger.info('attempting to create directory structure')
  logger.info('data directory created')
  mkdirp('data/static', (err) => {
    if (err) {
      return cb(err)
    }

    logger.info('data/static directory created')
    mkdirp('data/active', (err) => {
      if (err) {
        return cb(err)
      }

      logger.info('data/active directory created')
      cb()
    })
  })
}

function createStaticFiles() {
  logger.info('attempting to create static files')

  let date = getFormattedDate()
  let hour = getFormattedHour()
  mkdirp('data/static/' + date, (err) => {
    if (err) {
      return logger.error(err)
    }

    for (let endpoint of config.static_endpoints) {
      let creds = config.credentials
      let url = config.api + endpoint.route + '?app_id=' + creds.id + '&app_key=' + creds.key

      let options = {
        url: url,
        method: endpoint.method
      }

      let callback = (error, response, body) => {
        if (error) {
          return logger.error(error)
        }

        if (response.statusCode === 200) {
          let now = Date.now()
          let filename = endpoint.name + '_' + now
          let filepath = 'data/static/' + date + '/' + filename + '.json'

          fs.writeFile(filepath, body, (err) => {
            if (err) {
              return logger.error(err)
            }

            logger.info('created ' + filepath)
          })

          saveToCloudant(endpoint.name, now, date, hour, false)
        }
      }

      logger.info('requesting info from ' + endpoint.name, options)
      request(options, callback)
    }
  })
}

function beginRequestingActiveFiles() {
  logger.info('attempting to begin requesting active files')

  let date = getFormattedDate()
  let hour = getFormattedHour()
  mkdirp('data/active/' + date + '/' + hour, (err) => {
    if (err) {
      return logger.error(err)
    }

    for (let endpoint of config.active_endpoints) {
      let creds = config.credentials
      let url = config.api + endpoint.route + '?app_id=' + creds.id + '&app_key=' + creds.key

      let options = {
        url: url,
        method: endpoint.method
      }

      let callback = (error, response, body) => {
        if (error) {
          return logger.error(error)
        }

        if (response.statusCode === 200) {
          let now = Date.now()
          let newDate = getFormattedDate()
          let newHour = getFormattedHour()

          function writeFile() {
            let filename = endpoint.name + '_' + now
            let filepath = 'data/active/' + date + '/' + hour + '/' + filename + '.json'

            fs.writeFile(filepath, body, (err) => {
              if (err) {
                return logger.error(err)
              }

              logger.info('created ' + filepath)

              let json = JSON.parse(body)
              if (endpoint.name === 'traffic_camera') {
                getJamCams(json, date, hour, now)
              }

              saveToCloudant(endpoint.name, now, date, hour, true)
            })
          }

          if (date !== newDate || hour !== newHour) {
            date = newDate
            hour = newHour
            mkdirp('data/active/' + date + '/' + hour, (err) => {
              if (err) {
                return logger.error(err)
              }

              writeFile()
            })
          } else {
            writeFile()
          }
        }
      }

      let timeout = endpoint.frequency * 1000 * 60 // mins to millisecs

      logger.info('requesting info from ' + endpoint.name + ' every ' + endpoint.frequency + ' minutes', options)
      request(options, callback)
      setInterval(() => request(options, callback), timeout)
    }
  })
}

function getJamCams(json, date, hour, now) {
  logger.info('attempting to download images from JamCams')
  for (let cam of json) {
    for (let prop of cam.additionalProperties) {
      if (prop.key === 'imageUrl') {
        let imageUrl = prop.value

        let options = {
          url: imageUrl,
          method: 'GET'
        }

        let imgDir = 'data/img/' + date + '/' + hour + '/' + now
        mkdirp(imgDir, (err) => {
          if (err) {
            return logger.error(err)
          }

          request(options, (err) => {
            if (err) {
              return logger.error(err)
            }

          }).pipe(fs.createWriteStream(imgDir + '/' + cam.id + '.jpg'))
        })

        break
      }
    }
  }
}

app.use(function(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')
  next()
})

var appEnv = cfenv.getAppEnv()

app.listen(appEnv.port, () => {
  logger.info('server starting on ' + appEnv.url)

  createFileStructure((err) => {
    if (err) {
      return logger.error(err)
    }

    createStaticFiles()

    beginRequestingActiveFiles((err) => {
      if (err) {
        return logger.error(err)
      }
    })
  })
})
