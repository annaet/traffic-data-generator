const cfenv = require('cfenv')
const express = require('express')
const request = require('request')
const winston = require('winston')
const mkdirp = require('mkdirp')
const fs = require('fs')
const app = express()

const config = require('./config')

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
          let filename = 'data/static/' + date + '/' + endpoint.name + '_' + now + '.json'
          fs.writeFile(filename, body, (err) => {
            if (err) {
              return logger.error(err)
            }

            logger.info('created ' + filename)
          })
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
  mkdirp('data/active/' + date, (err) => {
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

          function writeFile() {
            let filename = 'data/active/' + date + '/' + endpoint.name + '_' + now + '.json'
            fs.writeFile(filename, body, (err) => {
              if (err) {
                return logger.error(err)
              }

              logger.info('created ' + filename)
            })
          }

          if (date !== newDate) {
            date = newDate
            mkdirp('data/active/' + date, (err) => {
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


app.get('/', (req, res) => {
  res.send('Hello World!')
})


// get the app environment from Cloud Foundry
var appEnv = cfenv.getAppEnv()

// start server on the specified port and binding host
app.listen(appEnv.port, () => {
  console.log('server starting on ' + appEnv.url)
})
